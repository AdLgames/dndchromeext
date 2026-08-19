import { loadDataset } from "../data/load";
import { clearPins, getPins, onPinsChanged, togglePin } from "../pins";
import {
  buildAliasIndex, findHighlight, getRecency, recordMiss, recordView, search,
  type SearchMatch,
} from "../search";
import {
  DEFAULT_SETTINGS, getSettings, onSettingsChanged, resolveTheme, saveSettings,
  type Settings,
} from "../settings";
import {
  GROUP_LABELS, RULE_GROUPS,
  type AbilityScores, type NamedEntry, type Rule, type RuleGroup,
} from "../types";
import { el, highlighted, icon } from "./dom";

const ATTRIBUTION =
  "Includes material from the D&D System Reference Document 5.1, © Wizards of the Coast LLC, CC BY 4.0.";

const GROUP_ICONS: Record<RuleGroup, "bestiary" | "spells" | "rules" | "items" | "classes"> = {
  bestiary: "bestiary", spells: "spells", rules: "rules", items: "items", classes: "classes",
};

const ABILITY_KEYS: (keyof AbilityScores)[] = ["str", "dex", "con", "int", "wis", "cha"];

type View = "browse" | "results" | "detail" | "pinned" | "settings";

export type PanelOptions = {
  /** Shown as a close button in the header; omitted in the side panel. */
  onClose?: () => void;
  /** Side panel shows the ⌘K affordance; the overlay is already modal. */
  showShortcutHint?: boolean;
  /**
   * Element the `data-theme` attribute is written to. Must be the node
   * carrying `.ro-root`, since that is where the tokens are defined —
   * defaults to the panel root.
   */
  themeTarget?: HTMLElement;
};

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

export class Panel {
  private root: HTMLElement;
  private opts: PanelOptions;

  private rules: Rule[] = [];
  private rulesById = new Map<string, Rule>();
  private aliasIndex = new Map<string, string>();
  private recency: Record<string, number> = {};
  private settings: Settings = DEFAULT_SETTINGS;
  private pins: string[] = [];
  private counts: Record<RuleGroup, number> = {
    bestiary: 0, spells: 0, rules: 0, items: 0, classes: 0,
  };

  private view: View = "browse";
  private query = "";
  private matches: SearchMatch[] = [];
  private selected = 0;
  private groupFilter: RuleGroup | "all" = "all";
  private detail: Rule | null = null;
  private history: string[] = [];
  private openSections = new Set<string>(["defenses", "traits", "actions", "reactions", "legendary"]);
  private openPin: string | null = null;
  private input: HTMLInputElement | null = null;
  private focusMode: "none" | "caret" | "select" = "none";
  private caret = 0;
  private everFocused = false;
  private ready: Promise<void>;

  constructor(root: HTMLElement, opts: PanelOptions = {}) {
    this.root = root;
    this.opts = opts;
    this.ready = this.init();
  }

  private async init() {
    const [{ rules, aliases }, recency, settings, pins] = await Promise.all([
      loadDataset(), getRecency(), getSettings(), getPins(),
    ]);
    this.rules = rules;
    this.rulesById = new Map(rules.map((r) => [r.id, r]));
    this.aliasIndex = buildAliasIndex(aliases);
    this.recency = recency;
    this.settings = settings;
    this.pins = pins;
    for (const rule of rules) this.counts[rule.group] += 1;

    onSettingsChanged((next) => { this.settings = next; this.applyTheme(); this.render(); });
    onPinsChanged((next) => { this.pins = next; this.render(); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());

    this.applyTheme();
    this.render();
    // Boot is async, so an earlier focus() landed on an input this render
    // has just replaced — put the caret back where the caller wanted it.
    if (this.everFocused) this.focus();
  }

  private applyTheme() {
    (this.opts.themeTarget ?? this.root).dataset.theme = resolveTheme(this.settings.appearance);
  }

  /**
   * Focus the search field. The panel boots asynchronously (the dataset is
   * fetched, not bundled), so a focus() call can land before the input
   * exists — the intent is latched and re-applied once it does.
   */
  focus() {
    this.everFocused = true;
    this.focusMode = "select";
    this.applyFocus();
  }

  private applyFocus() {
    if (this.focusMode === "none" || !this.input) return;
    const mode = this.focusMode;
    this.focusMode = "none";
    this.input.focus();
    if (mode === "select") this.input.select();
    else this.input.setSelectionRange(this.caret, this.caret);
  }

  /** Runs a query from outside (selection lookup). */
  async lookup(query: string) {
    await this.ready;
    this.query = query;
    this.view = "results";
    this.detail = null;
    this.runSearch();
    this.focus();
  }

  reset() {
    this.query = "";
    this.view = "browse";
    this.detail = null;
    this.history = [];
    this.matches = [];
    this.selected = 0;
    this.groupFilter = "all";
    this.render();
  }

  /** Logs an abandoned zero-result search so aliases can be grown from it. */
  flushMiss() {
    if (this.view === "results" && this.query.trim().length >= 3 && this.matches.length === 0) {
      void recordMiss(this.query);
    }
  }

  private runSearch() {
    this.matches = this.query.trim()
      ? search(this.query, this.rules, this.aliasIndex, this.recency, { sources: this.settings.sources })
      : [];
    this.selected = 0;
    this.groupFilter = "all";
    this.view = this.query.trim() ? "results" : "browse";
    this.render();
  }

  /**
   * Results grouped for display. Groups are ordered by their best-scoring
   * member so the strongest match always leads — grouping alone would bury
   * an exact title hit under a weak match from an earlier group.
   */
  private groupedMatches(): { group: RuleGroup; matches: SearchMatch[] }[] {
    const pool = this.groupFilter === "all"
      ? this.matches
      : this.matches.filter((m) => m.rule.group === this.groupFilter);

    const byGroup = new Map<RuleGroup, SearchMatch[]>();
    for (const match of pool) {
      const list = byGroup.get(match.rule.group);
      if (list) list.push(match);
      else byGroup.set(match.rule.group, [match]);
    }

    return Array.from(byGroup, ([group, matches]) => ({ group, matches }))
      .sort((a, b) => b.matches[0].score - a.matches[0].score);
  }

  /** Flat result order, identical to what is rendered — drives ↑/↓ and Enter. */
  private visibleMatches(): SearchMatch[] {
    return this.groupedMatches().flatMap((g) => g.matches);
  }

  private open(rule: Rule, pushHistory = true) {
    if (pushHistory && this.detail) this.history.push(this.detail.id);
    this.detail = rule;
    this.view = "detail";
    void recordView(rule.id).then(() => getRecency()).then((r) => { this.recency = r; });
    this.render();
  }

  private back() {
    const prev = this.history.pop();
    if (prev && this.rulesById.has(prev)) {
      this.detail = this.rulesById.get(prev)!;
      this.render();
      return;
    }
    this.detail = null;
    this.view = this.query.trim() ? "results" : "browse";
    this.render();
  }

  handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.view === "detail" || this.view === "settings" || this.view === "pinned") this.back();
      else if (this.query) { this.query = ""; this.runSearch(); this.focus(); }
      else this.opts.onClose?.();
      return;
    }
    if (this.view !== "results") return;

    const visible = this.visibleMatches();
    if (e.key === "ArrowDown" && visible.length) {
      e.preventDefault();
      this.selected = (this.selected + 1) % visible.length;
      this.render();
    } else if (e.key === "ArrowUp" && visible.length) {
      e.preventDefault();
      this.selected = (this.selected - 1 + visible.length) % visible.length;
      this.render();
    } else if (e.key === "Enter" && visible[this.selected]) {
      e.preventDefault();
      this.open(visible[this.selected].rule);
    }
  }

  // ------------------------------------------------------------ render --
  private render() {
    this.root.textContent = "";
    this.root.append(this.renderRail(), this.renderPanel());
    this.applyFocus();
  }

  private renderRail(): HTMLElement {
    return el("div", { class: "rail" }, [
      icon("diamond", 18),
      el("span", { class: "rail-name", text: "Rules Overlay" }),
      this.pins.length ? el("span", { class: "rail-count", text: String(this.pins.length) }) : null,
    ]);
  }

  private renderPanel(): HTMLElement {
    const panel = el("div", { class: "panel" });
    this.input = null; // detached by the rebuild; renderSearch re-assigns it

    if (this.view === "detail" && this.detail) {
      panel.append(this.renderDetailHeader(), this.renderDetailBody(this.detail), this.footer());
    } else if (this.view === "settings") {
      panel.append(this.renderSubHeader("Settings"), this.renderSettings(), this.renderSettingsFoot());
    } else if (this.view === "pinned") {
      panel.append(this.renderSubHeader("Pinned"), this.renderPinned(), this.footer());
    } else {
      panel.append(this.renderHeader(), this.renderSearch());
      panel.append(this.view === "results" ? this.renderResults() : this.renderBrowse());
      panel.append(this.view === "results" ? this.renderKeys() : this.footer());
    }
    return panel;
  }

  private headActions(extra?: HTMLElement): HTMLElement {
    // In the detail view the pin icon toggles *this* entry, so it stands in
    // for the pinned-list button rather than sitting next to a second pin.
    const pinBtn = extra ?? el("button", {
      class: `icon-btn${this.pins.length ? " on" : ""}`,
      title: this.pins.length ? `Pinned (${this.pins.length})` : "Pinned",
      onclick: () => { this.view = "pinned"; this.render(); },
    }, [icon("pin", 15)]);

    const settingsBtn = el("button", {
      class: "icon-btn", title: "Settings",
      onclick: () => { this.view = "settings"; this.render(); },
    }, [icon("settings", 15)]);

    const kids: (HTMLElement | null)[] = [pinBtn, settingsBtn];
    if (this.opts.onClose) {
      kids.push(el("button", { class: "icon-btn", title: "Close", onclick: () => this.opts.onClose!() }, [icon("close", 15)]));
    }
    return el("div", { class: "head-actions" }, kids);
  }

  private renderHeader(): HTMLElement {
    return el("div", { class: "head" }, [
      icon("diamond", 16),
      el("span", { class: "brand", text: "Rules Overlay" }),
      el("span", { class: "brand-sub", text: "5e SRD" }),
      this.headActions(),
    ]);
  }

  private renderSubHeader(title: string): HTMLElement {
    return el("div", { class: "head" }, [
      el("button", { class: "back-btn", onclick: () => this.back() }, [icon("back", 14), "Back"]),
      el("span", { class: "brand", text: title }),
    ]);
  }

  private renderDetailHeader(): HTMLElement {
    const rule = this.detail!;
    const pinned = this.pins.includes(rule.id);
    const pinBtn = el("button", {
      class: `icon-btn${pinned ? " on" : ""}`,
      title: pinned ? "Unpin" : "Pin",
      onclick: async () => { this.pins = await togglePin(rule.id); this.render(); },
    }, [icon("pin", 15)]);

    return el("div", { class: "head" }, [
      el("button", { class: "back-btn", onclick: () => this.back() }, [
        icon("back", 14),
        this.history.length || this.query ? "Results" : "Browse",
      ]),
      this.headActions(pinBtn),
    ]);
  }

  private renderSearch(): HTMLElement {
    const input = el("input", {
      type: "text",
      placeholder: "Search monsters, spells, rules…",
      autocomplete: "off",
      spellcheck: false,
      "aria-label": "Search",
    });
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      // The re-render swaps this node out, so carry the caret across it.
      this.caret = input.selectionStart ?? input.value.length;
      this.focusMode = "caret";
      this.runSearch();
    });
    this.input = input;

    const box = el("div", { class: "searchbox" }, [
      icon("search", 15),
      input,
      this.query.trim()
        ? el("span", { class: "hits", text: `${this.matches.length} hits` })
        : this.opts.showShortcutHint
          ? el("span", { class: "kbd", text: "⌘K" })
          : null,
    ]);

    const wrap = el("div", { class: "searchwrap" }, [box]);
    if (this.view === "results" && this.matches.length) wrap.append(this.renderChips());
    return wrap;
  }

  private renderChips(): HTMLElement {
    const perGroup = new Map<RuleGroup, number>();
    for (const m of this.matches) perGroup.set(m.rule.group, (perGroup.get(m.rule.group) ?? 0) + 1);

    const chip = (label: string, value: RuleGroup | "all") =>
      el("button", {
        class: `chip${this.groupFilter === value ? " on" : ""}`,
        text: label,
        onclick: () => { this.groupFilter = value; this.selected = 0; this.render(); },
      });

    const chips = [chip("All", "all")];
    for (const group of RULE_GROUPS) {
      const n = perGroup.get(group);
      if (n) chips.push(chip(`${GROUP_LABELS[group]} ${n}`, group));
    }
    return el("div", { class: "chips" }, chips);
  }

  private renderBrowse(): HTMLElement {
    const tile = (group: RuleGroup, countLabel: string, wide = false) =>
      el("button", {
        class: `tile${wide ? " wide" : ""}`,
        onclick: () => { this.query = GROUP_LABELS[group]; this.runSearch(); },
      }, [
        icon(GROUP_ICONS[group], 18),
        el("span", { class: "tile-name", text: GROUP_LABELS[group] }),
        el("span", { class: "tile-count", text: countLabel }),
      ]);

    return el("div", { class: "body" }, [
      el("div", { class: "browse" }, [
        el("span", { class: "label", text: "Browse" }),
        el("div", { class: "tiles" }, [
          tile("bestiary", `${this.counts.bestiary} creatures`),
          tile("spells", `${this.counts.spells} spells`),
          tile("rules", `${this.counts.rules} entries`),
          tile("items", `${this.counts.items} items`),
          tile("classes", `${this.counts.classes} classes & features`, true),
        ]),
        el("p", { class: "hintline" }, [
          "Select text on any page and press ",
          el("span", { class: "kbd", text: "Ctrl+Shift+D" }),
          " to look it up here.",
        ]),
      ]),
    ]);
  }

  private renderResults(): HTMLElement {
    const body = el("div", { class: "body" });
    const grouped = this.groupedMatches();

    if (!grouped.length) {
      body.append(el("div", { class: "empty", text: "No matching entry. Try a shorter term, or table-slang like “aoo”." }));
      return body;
    }

    let index = 0;
    for (const { group, matches: inGroup } of grouped) {
      body.append(el("div", { class: "group-head" }, [
        el("span", { text: GROUP_LABELS[group] }),
        el("span", { text: String(inGroup.length) }),
      ]));

      for (const match of inGroup) {
        const i = index++;
        const range = findHighlight(match.rule.title, this.query);
        body.append(el("button", {
          class: `row${i === this.selected ? " sel" : ""}`,
          onmouseenter: () => { this.selected = i; this.syncSelection(); },
          onclick: () => this.open(match.rule),
        }, [
          el("div", { class: "row-main" }, [
            el("span", { class: "row-title" }, highlighted(match.rule.title, range)),
            match.rule.subtitle ? el("span", { class: "row-sub", text: match.rule.subtitle }) : null,
          ]),
          match.rule.badge ? el("span", { class: "row-badge", text: match.rule.badge }) : null,
        ]));
      }
    }

    queueMicrotask(() => body.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" }));
    return body;
  }

  /** Selection-only update, so hovering doesn't rebuild the whole list. */
  private syncSelection() {
    const rows = this.root.querySelectorAll<HTMLElement>(".row");
    rows.forEach((row, i) => row.classList.toggle("sel", i === this.selected));
  }

  private renderKeys(): HTMLElement {
    return el("div", { class: "keys" }, [
      el("span", { text: "↑↓ Move" }),
      el("span", { text: "↵ Open" }),
      el("span", { text: "Esc Clear" }),
    ]);
  }

  private footer(): HTMLElement {
    return el("div", { class: "footer", text: ATTRIBUTION });
  }

  // ------------------------------------------------------------ detail --
  private section(key: string, name: string, count: number | null, build: () => HTMLElement[]): HTMLElement[] {
    const open = this.openSections.has(key);
    const head = el("button", {
      class: "section-head",
      onclick: () => {
        if (open) this.openSections.delete(key); else this.openSections.add(key);
        this.render();
      },
    }, [
      el("span", { class: "section-name", text: name }),
      count !== null ? el("span", { class: "section-count", text: String(count) }) : null,
      el("span", { class: "section-mark", text: open ? "−" : "+" }),
    ]);
    return open ? [head, ...build()] : [head];
  }

  private kv(key: string, value: string | undefined): HTMLElement | null {
    if (!value) return null;
    return el("div", { class: "kv" }, [
      el("span", { class: "kv-k", text: key }),
      el("span", { text: value }),
    ]);
  }

  private namedEntries(entries: NamedEntry[]): HTMLElement {
    return el("div", { class: "section-body" }, entries.map((entry) =>
      el("div", { class: "entry" }, [
        el("div", { class: "entry-head" }, [el("span", { class: "entry-name", text: entry.name })]),
        el("p", { class: "prose", text: entry.desc }),
      ])
    ));
  }

  private renderDetailBody(rule: Rule): HTMLElement {
    const body = el("div", { class: "body" });

    body.append(el("div", { class: "detail-head" }, [
      el("span", { class: "kicker", text: `${GROUP_LABELS[rule.group]} · SRD 5.1` }),
      el("h1", { class: "detail-title", text: rule.title }),
      rule.subtitle ? el("span", { class: "detail-sub", text: rule.subtitle }) : null,
    ]));

    if (rule.monster) body.append(...this.renderMonster(rule));
    else if (rule.spell) body.append(...this.renderSpell(rule));
    else body.append(...this.renderProse(rule));

    if (rule.seeAlso?.length) {
      const links: (Node | string)[] = ["See also: "];
      rule.seeAlso.forEach((id, i) => {
        const related = this.rulesById.get(id);
        if (!related) return;
        if (i > 0) links.push(", ");
        links.push(el("button", { text: related.title, onclick: () => this.open(related) }));
      });
      body.append(el("div", { class: "see-also" }, links));
    }

    return body;
  }

  private renderMonster(rule: Rule): HTMLElement[] {
    const m = rule.monster!;
    const out: HTMLElement[] = [];

    const stat = (k: string, v: string, note?: string) =>
      el("div", { class: "stat" }, [
        el("span", { class: "stat-k", text: k }),
        el("span", { class: "stat-v", text: v }),
        note ? el("span", { class: "stat-n", text: note }) : null,
      ]);

    out.push(el("div", { class: "statgrid" }, [
      stat("AC", String(m.ac), m.acNote),
      stat("HP", String(m.hp), m.hitDice),
      stat("CR", m.cr, `${m.xp.toLocaleString()} XP`),
      stat("Prof", `+${m.prof}`),
    ]));

    if (m.speeds.length) {
      out.push(el("div", { class: "speedrow" }, m.speeds.map((s) =>
        el("span", {}, [el("span", { class: "stat-k", text: s.label }), s.value])
      )));
    }

    out.push(el("div", { class: "abilities" }, ABILITY_KEYS.map((key) => {
      const score = m.abilities[key];
      const mod = modifier(score);
      return el("div", { class: "abil" }, [
        el("span", { class: "abil-k", text: key.toUpperCase() }),
        el("span", { class: "abil-v", text: String(score) }),
        el("span", { class: `abil-m${mod.startsWith("+") && mod !== "+0" ? " pos" : ""}`, text: mod }),
      ]);
    })));

    const defenses = [
      this.kv("Saves", m.saves), this.kv("Skills", m.skills),
      this.kv("Vulnerable", m.vulnerabilities), this.kv("Resistant", m.resistances),
      this.kv("Immunities", m.immunities), this.kv("Cond. immune", m.conditionImmunities),
      this.kv("Senses", m.senses), this.kv("Languages", m.languages),
    ].filter(Boolean) as HTMLElement[];

    if (defenses.length) {
      out.push(...this.section("defenses", "Defenses & senses", null, () => [
        el("div", { class: "section-body" }, defenses),
      ]));
    }

    if (m.traits.length) {
      out.push(...this.section("traits", "Traits", m.traits.length, () => [this.namedEntries(m.traits)]));
    }

    if (m.actions.length) {
      out.push(...this.section("actions", "Actions", m.actions.length, () => [
        el("div", { class: "section-body" }, m.actions.map((a) =>
          el("div", { class: "entry" }, [
            el("div", { class: "entry-head" }, [
              el("span", { class: "entry-name", text: a.name }),
              a.label ? el("span", { class: "entry-label", text: a.label }) : null,
              a.value ? el("span", { class: "entry-value", text: a.value }) : null,
            ]),
            el("p", { class: "prose", text: a.desc }),
          ])
        )),
      ]));
    }

    if (m.reactions.length) {
      out.push(...this.section("reactions", "Reactions", m.reactions.length, () => [this.namedEntries(m.reactions)]));
    }
    if (m.legendary.length) {
      out.push(...this.section("legendary", "Legendary actions", m.legendary.length, () => [this.namedEntries(m.legendary)]));
    }
    return out;
  }

  private renderSpell(rule: Rule): HTMLElement[] {
    const s = rule.spell!;
    const meta = [
      this.kv("Casting time", s.castingTime),
      this.kv("Range", s.range),
      this.kv("Components", s.material ? `${s.components} (${s.material})` : s.components),
      this.kv("Duration", s.concentration ? `Concentration, ${s.duration}` : s.duration),
      this.kv("Classes", s.classes.join(", ")),
    ].filter(Boolean) as HTMLElement[];

    const out: HTMLElement[] = [el("div", { class: "section-body" }, meta)];
    out.push(el("div", { class: "section-body" }, [el("p", { class: "prose", text: rule.body })]));
    if (s.higherLevel) {
      out.push(...this.section("higher", "At higher levels", null, () => [
        el("div", { class: "section-body" }, [el("p", { class: "prose", text: s.higherLevel! })]),
      ]));
    }
    return out;
  }

  private renderProse(rule: Rule): HTMLElement[] {
    const meta: HTMLElement[] = [];
    if (rule.item) {
      const kv = [
        this.kv("Type", rule.item.kind),
        this.kv("Rarity", rule.item.rarity),
        this.kv("Attunement", rule.item.attunement ? "Required" : undefined),
      ].filter(Boolean) as HTMLElement[];
      if (kv.length) meta.push(el("div", { class: "section-body" }, kv));
    }
    if (rule.feature) {
      const kv = [
        this.kv("Class", rule.feature.className),
        this.kv("Level", rule.feature.level ? String(rule.feature.level) : undefined),
        this.kv("Subclass", rule.feature.subclass),
      ].filter(Boolean) as HTMLElement[];
      if (kv.length) meta.push(el("div", { class: "section-body" }, kv));
    }
    return [...meta, el("div", { class: "section-body" }, [el("p", { class: "prose", text: rule.body })])];
  }

  // ------------------------------------------------------------ pinned --
  private renderPinned(): HTMLElement {
    const body = el("div", { class: "body" });
    const pinned = this.pins.map((id) => this.rulesById.get(id)).filter(Boolean) as Rule[];

    if (!pinned.length) {
      body.append(el("div", { class: "empty", text: "Nothing pinned yet. Open an entry and press the pin icon to keep it here while you play." }));
      return body;
    }

    body.append(el("div", { class: "pinbar" }, [
      icon("pin", 14),
      el("span", { class: "pinbar-title", text: `Pinned — ${pinned.length} ${pinned.length === 1 ? "entry" : "entries"}` }),
      el("button", { text: "Unpin all", onclick: async () => { await clearPins(); this.pins = []; this.render(); } }),
    ]));

    for (const rule of pinned) {
      const open = this.openPin === rule.id;
      body.append(el("button", {
        class: `pin-head${open ? " open" : ""}`,
        onclick: () => { this.openPin = open ? null : rule.id; this.render(); },
      }, [
        el("span", { class: "pin-name", text: rule.title }),
        rule.badge ? el("span", { class: "pin-badge", text: rule.badge }) : null,
        el("span", { class: "pin-mark", text: open ? "−" : "+" }),
      ]));

      if (!open) continue;

      const rows: (HTMLElement | null)[] = [];
      const m = rule.monster;
      if (m) {
        rows.push(el("div", { class: "pin-stats" }, [
          el("span", {}, [el("span", { class: "stat-k", text: "AC" }), " ", String(m.ac)]),
          el("span", {}, [el("span", { class: "stat-k", text: "HP" }), " ", String(m.hp)]),
          el("span", {}, [el("span", { class: "stat-k", text: "Speed" }), " ", m.speeds.map((s) => s.value).join(" / ")]),
        ]));
        for (const a of m.actions.slice(0, 3)) {
          rows.push(el("p", { class: "prose" }, [
            el("b", { text: a.name }),
            a.value ? ` ${a.value}` : "",
            ` — ${a.desc}`,
          ]));
        }
      } else {
        rows.push(el("p", { class: "prose", text: rule.body.slice(0, 320) }));
      }
      rows.push(el("button", { class: "back-btn", onclick: () => this.open(rule) }, ["Open full entry"]));
      body.append(el("div", { class: "pin-body" }, rows));
    }

    return body;
  }

  // ---------------------------------------------------------- settings --
  private renderSettings(): HTMLElement {
    const sources = el("div", { class: "set-list" }, RULE_GROUPS.map((group) => {
      const on = this.settings.sources[group] !== false;
      return el("label", {
        class: `set-row${on ? "" : " off"}`,
        onclick: async (e: Event) => {
          e.preventDefault();
          this.settings = await saveSettings({
            sources: { ...this.settings.sources, [group]: !on },
          });
          this.render();
        },
      }, [
        el("span", { class: "check" }, [icon("check", 11, 2.5)]),
        el("span", { class: "set-name", text: GROUP_LABELS[group] }),
        el("span", { class: "set-count", text: String(this.counts[group]) }),
      ]);
    }));

    const appearance = el("div", { class: "seg" }, ([
      ["match", "Match page"], ["light", "Light"], ["dark", "Dark"],
    ] as const).map(([value, label]) =>
      el("button", {
        class: this.settings.appearance === value ? "on" : "",
        text: label,
        onclick: async () => {
          this.settings = await saveSettings({ appearance: value });
          this.applyTheme();
          this.render();
        },
      })
    ));

    const behaviorRow = (
      title: string, note: string, on: boolean, patch: (next: boolean) => Partial<Settings>
    ) => el("div", { class: "set-row" }, [
      el("div", { class: "set-text" }, [el("b", { text: title }), el("span", { text: note })]),
      el("span", {
        class: `switch${on ? "" : " off"}`,
        role: "switch",
        onclick: async () => { this.settings = await saveSettings(patch(!on)); this.render(); },
      }, [el("i", {})]),
    ]);

    return el("div", { class: "body" }, [
      el("div", { class: "settings" }, [
        el("div", { class: "set-group" }, [
          el("span", { class: "label", text: "Sources searched" }), sources,
        ]),
        el("div", { class: "set-group" }, [
          el("span", { class: "label", text: "Appearance" }), appearance,
        ]),
        el("div", { class: "set-group" }, [
          el("span", { class: "label", text: "Behavior" }),
          el("div", { class: "set-list" }, [
            behaviorRow("Keep panel pinned", "Stays open as you change tabs", this.settings.keepPinned,
              (next) => ({ keepPinned: next })),
            behaviorRow("Look up selected text", "Shortcut Ctrl+Shift+D", this.settings.selectionLookup,
              (next) => ({ selectionLookup: next })),
          ]),
        ]),
      ]),
    ]);
  }

  private renderSettingsFoot(): HTMLElement {
    return el("div", { class: "footbar" }, [
      el("span", { class: "label", text: `Data v5.1 · ${this.rules.length} local` }),
      el("button", {
        class: "btn-primary", text: "Shortcuts",
        onclick: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
      }),
    ]);
  }
}
