import {
  abilityMod, activeCombatant, advance, applyDamage, applyHealing, canAct, combatantBlank,
  combatantFromCharacter, combatantFromMonster, effectiveSpeed, EMPTY_ENCOUNTER, getEncounter,
  isDead, logEvent, onEncounterChanged, ordered, resolveAction, rollInitiativeForAll, rollSave,
  settleDeath,
  saveEncounter, TRACKED_CONDITIONS,
} from "../combat";
import { loadDataset } from "../data/load";
import {
  describeHomebrew, getHomebrew, HOMEBREW_SOURCE, HOMEBREW_SOURCE_ID, newHomebrewId,
  onHomebrewChanged, removeHomebrew, upsertHomebrew,
} from "../homebrew";
import { clearRollLog, formatRoll, getRollLog, pushRoll, roll, rollRepeated, type RollDetail } from "../dice";
import { getParty, onPartyChanged } from "../party";
import {
  characterPortraitKey, fileToDataUrl, getPortraits, onPortraitsChanged, removePortrait,
  setPortrait, type Portraits,
} from "../portraits";
import { scaleStatBlock } from "../scale";
import { clearPins, getPins, onPinsChanged, togglePin } from "../pins";
import {
  buildAliasIndex, crValue, findHighlight, getRecency, isFilterActive, matchesFilter,
  recordMiss, recordView, search, searchFlows,
  type SearchMatch, type StatFilter,
} from "../search";
import {
  DEFAULT_SETTINGS, getSettings, onSettingsChanged, resolveTheme, saveSettings,
  type Settings,
} from "../settings";
import {
  GROUP_LABELS, RULE_GROUPS,
  type AbilityScores, type Character, type Combatant, type CombatAction, type Encounter, type Flow,
  OPEN_TAB_MESSAGE, SRD_SOURCE_ID,
  type NamedEntry, type QuickAction, type Rule, type RuleGroup, type RuntimeMessage,
  type SourceRecord,
} from "../types";
import { el, highlighted, icon, prose } from "./dom";
import { emblem, emblemFor } from "./emblem";

const SRD_ATTRIBUTION =
  "Includes material from the D&D System Reference Document 5.1, © Wizards of the Coast LLC, CC BY 4.0.";

const GROUP_ICONS: Record<RuleGroup, "bestiary" | "spells" | "rules" | "items" | "classes"> = {
  bestiary: "bestiary", spells: "spells", rules: "rules", items: "items", classes: "classes",
};

const ABILITY_KEYS: (keyof AbilityScores)[] = ["str", "dex", "con", "int", "wis", "cha"];

type View = "browse" | "results" | "detail" | "pinned" | "settings" | "flow" | "catalog";
type Tab = "search" | "homebrew" | "combat";

type SortKey = "name" | "cr" | "ac" | "hp" | "level";

const CATALOG_PAGE = 80;

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

/**
 * Opens one of the extension's own pages. The side panel can do this
 * directly; the overlay is a content script, where chrome.tabs does not
 * exist, so it hands the URL to the service worker instead. Without this the
 * links simply threw on every page the overlay ran on.
 */
function openTab(url: string) {
  if (chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }
  void chrome.runtime.sendMessage({ type: OPEN_TAB_MESSAGE, url } satisfies RuntimeMessage)
    .catch(() => {});
}

export class Panel {
  private root: HTMLElement;
  private opts: PanelOptions;

  private rules: Rule[] = [];
  private bundled: Rule[] = [];
  private homebrew: Rule[] = [];
  private rulesById = new Map<string, Rule>();
  private flows: Flow[] = [];
  private flowsById = new Map<string, Flow>();
  private sources: SourceRecord[] = [];
  private sourcesById = new Map<string, SourceRecord>();
  private portraits: Portraits = {};
  private portraitError = "";
  private aliasIndex = new Map<string, string>();
  private recency: Record<string, number> = {};
  private settings: Settings = DEFAULT_SETTINGS;
  private pins: string[] = [];
  private counts: Record<RuleGroup, number> = {
    bestiary: 0, spells: 0, rules: 0, items: 0, classes: 0,
  };

  private tab: Tab = "search";
  private view: View = "browse";
  private catalogGroup: RuleGroup = "bestiary";
  private catalogFilter: StatFilter = {};
  private catalogSort: SortKey = "name";
  private catalogShown = CATALOG_PAGE;
  private scaleDelta = 0;
  private query = "";
  private matches: SearchMatch[] = [];
  private selected = 0;
  private groupFilter: RuleGroup | "all" = "all";
  private detail: Rule | null = null;
  private history: string[] = [];
  private openSections = new Set<string>(["defenses", "traits", "actions", "reactions", "legendary"]);
  private openPin: string | null = null;
  private explain = false;
  private flow: Flow | null = null;
  private lastRoll: RollDetail | null = null;
  private encounter: Encounter = EMPTY_ENCOUNTER;
  private party: Character[] = [];
  private combatPicker = false;
  private attackFrom: string | null = null;
  private attackMode: "normal" | "adv" | "dis" = "normal";
  private hpDelta = new Map<string, number>();
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
    const [{ rules, aliases, flows, sources }, recency, settings, pins, encounter, party, log, portraits, homebrew] =
      await Promise.all([
        loadDataset(), getRecency(), getSettings(), getPins(), getEncounter(), getParty(), getRollLog(),
        getPortraits(), getHomebrew(),
      ]);
    this.bundled = rules;
    this.flows = flows;
    this.flowsById = new Map(flows.map((f) => [f.id, f]));
    // Your own entries are a pack alongside the bundled ones, so they get a
    // source record and therefore a footer notice, a result tag and a
    // settings toggle for free.
    this.sources = [...sources, HOMEBREW_SOURCE];
    this.sourcesById = new Map(this.sources.map((s) => [s.id, s]));
    this.setHomebrew(homebrew);
    this.aliasIndex = buildAliasIndex(aliases);
    this.recency = recency;
    this.settings = settings;
    this.pins = pins;
    this.encounter = encounter;
    this.party = party;
    this.lastRoll = log[0] ?? null;
    this.portraits = portraits;

    onSettingsChanged((next) => { this.settings = next; this.applyTheme(); this.render(); });
    onPinsChanged((next) => { this.pins = next; this.render(); });
    onEncounterChanged((next) => { this.encounter = next; this.render(); });
    // The party page is a separate tab, so characters are usually created
    // *after* this panel booted — without this it kept the empty list it
    // loaded with and "Add from your party" stayed empty forever.
    onPartyChanged((next) => { this.party = next; this.render(); });
    onPortraitsChanged((next) => { this.portraits = next; this.render(); });
    onHomebrewChanged((next) => { this.setHomebrew(next); this.render(); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());

    this.applyTheme();
    this.render();
    // Boot is async, so an earlier focus() landed on an input this render
    // has just replaced — put the caret back where the caller wanted it.
    if (this.everFocused) this.focus();
  }

  /**
   * Rebuilds the searchable corpus. Homebrew is appended rather than merged
   * by title so an entry you wrote never silently displaces a published one
   * — both show, tagged by their pack.
   */
  private setHomebrew(entries: Rule[]) {
    this.homebrew = entries.map(describeHomebrew);
    this.rules = [...this.bundled, ...this.homebrew];
    this.rulesById = new Map(this.rules.map((r) => [r.id, r]));
    this.counts = { bestiary: 0, spells: 0, rules: 0, items: 0, classes: 0 };
    for (const rule of this.rules) this.counts[rule.group] += 1;
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
      ? search(this.query, this.rules, this.aliasIndex, this.recency, {
          sources: this.settings.sources, packs: this.settings.packs,
        })
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
    if (rule.id !== this.detail?.id) this.scaleDelta = 0;
    this.detail = rule;
    this.view = "detail";
    this.explain = false;
    void recordView(rule.id).then(() => getRecency()).then((r) => { this.recency = r; });
    this.render();
  }

  private showRoll(detail: RollDetail) {
    this.lastRoll = detail;
    void pushRoll(detail);
    this.render();
  }

  private doRoll(expr: string, label?: string) {
    this.showRoll(roll(expr, { label }));
  }

  /** Runs a quick action: rolls it, or navigates where it points. */
  private runAction(action: QuickAction) {
    switch (action.kind) {
      case "roll":
        this.doRoll(action.expr, action.label);
        break;
      case "check":
        this.showRoll(roll("1d20", { label: action.ability }));
        break;
      case "perUnit": {
        const raw = prompt(`How many ${action.unit}?`);
        if (raw === null) return;
        const amount = parseInt(raw, 10);
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.showRoll(rollRepeated(action.expr, Math.floor(amount / action.unitSize), action.label));
        break;
      }
      case "rule": {
        const rule = this.rulesById.get(action.ruleId);
        if (rule) this.open(rule);
        break;
      }
      case "flow": {
        const flow = this.flowsById.get(action.flowId);
        if (flow) this.openFlow(flow);
        break;
      }
      case "note":
        alert(action.text);
        break;
    }
  }

  private openFlow(flow: Flow) {
    this.flow = flow;
    this.view = "flow";
    this.render();
  }

  private async updateEncounter(next: Encounter) {
    this.encounter = next;
    await saveEncounter(next);
    this.render();
  }

  private patchCombatant(id: string, patch: Partial<Combatant>) {
    void this.updateEncounter({
      ...this.encounter,
      combatants: this.encounter.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  private back() {
    // Side trips (a flow, the pinned list, settings, the tracker) return to
    // wherever you were; only the detail view walks its own history stack.
    if (this.view !== "detail") {
      this.flow = null;
      this.combatPicker = false;
      this.view = this.detail ? "detail" : this.query.trim() ? "results" : "browse";
      this.render();
      return;
    }
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
      if (this.tab !== "search") { this.tab = "search"; this.render(); this.focus(); }
      else if (this.view !== "browse" && this.view !== "results") this.back();
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

    if (this.tab === "combat") {
      panel.append(this.renderHeader(), this.renderTabs(), this.renderCombat());
      panel.append(this.rollStrip() ?? this.footer());
      return panel;
    }

    if (this.tab === "homebrew" && this.view !== "detail") {
      panel.append(this.renderHeader(), this.renderTabs(), this.renderHomebrewTab());
      panel.append(this.footer());
      return panel;
    }

    if (this.view === "catalog") {
      panel.append(this.renderSubHeader(GROUP_LABELS[this.catalogGroup]), this.renderCatalog());
      return panel;
    }

    if (this.view === "detail" && this.detail) {
      panel.append(this.renderDetailHeader(), this.renderDetailBody(this.detail));
      panel.append(this.rollStrip() ?? this.footer(this.detail));
    } else if (this.view === "settings") {
      panel.append(this.renderSubHeader("Settings"), this.renderSettings(), this.renderSettingsFoot());
    } else if (this.view === "pinned") {
      panel.append(this.renderSubHeader("Session"), this.renderPinned(), this.footer());
    } else if (this.view === "flow" && this.flow) {
      panel.append(this.renderSubHeader("Walkthrough"), this.renderFlow(this.flow));
      panel.append(this.rollStrip() ?? this.footer());
    } else {
      panel.append(this.renderHeader(), this.renderTabs(), this.renderSearch());
      panel.append(this.view === "results" ? this.renderResults() : this.renderBrowse());
      panel.append(this.view === "results" ? this.renderKeys() : this.footer());
    }
    return panel;
  }

  private renderTabs(): HTMLElement {
    const inFight = this.encounter.combatants.length;
    const tab = (key: Tab, label: string, extra?: HTMLElement | null) =>
      el("button", {
        class: this.tab === key ? "on" : "",
        onclick: () => {
          this.tab = key;
          this.combatPicker = false;
          this.render();
          if (key === "search") this.focus();
        },
      }, [label, extra ?? null]);

    return el("div", { class: "tabs" }, [
      tab("search", "Search"),
      tab("homebrew", "Homebrew", this.homebrew.length
        ? el("span", { class: "tab-count", text: String(this.homebrew.length) })
        : null),
      tab("combat", "Combat", inFight
        ? el("span", { class: "tab-count", text: String(inFight) })
        : null),
    ]);
  }

  /** The last roll, shown as a persistent strip above the footer. */
  private rollStrip(): HTMLElement | null {
    const detail = this.lastRoll;
    if (!detail) return null;
    return el("div", { class: "rolls" }, [
      el("span", {
        class: `roll-total${detail.crit === "hit" ? " crit-hit" : detail.crit === "miss" ? " crit-miss" : ""}`,
        text: String(detail.total),
      }),
      el("div", { class: "roll-meta" }, [
        el("span", { class: "roll-label", text: detail.label ?? detail.expr }),
        el("span", {
          class: "roll-detail",
          text: `${detail.expr} ${formatRoll(detail)}${detail.crit === "hit" ? " · critical!" : detail.crit === "miss" ? " · natural 1" : ""}`,
        }),
      ]),
      el("button", {
        class: "icon-btn", title: "Clear rolls",
        onclick: () => { this.lastRoll = null; void clearRollLog(); this.render(); },
      }, [icon("close", 14)]),
    ]);
  }

  private headActions(extra?: HTMLElement): HTMLElement {
    // In the detail view the pin icon toggles *this* entry, so it stands in
    // for the pinned-list button rather than sitting next to a second pin.
    const pinBtn = extra ?? el("button", {
      class: `icon-btn${this.pins.length ? " on" : ""}`,
      title: this.pins.length ? `Pinned (${this.pins.length})` : "Pinned",
      onclick: () => { this.view = "pinned"; this.render(); },
    }, [icon("pin", 15)]);

    const partyBtn = el("button", {
      class: `icon-btn${this.party.length ? " on" : ""}`,
      title: this.party.length ? `Your party (${this.party.length})` : "Your party",
      onclick: () => openTab(chrome.runtime.getURL("party.html")),
    }, [icon("classes", 15)]);

    const combatBtn = el("button", {
      class: `icon-btn${this.encounter.combatants.length ? " on" : ""}`,
      title: this.encounter.combatants.length
        ? `Combat — round ${this.encounter.round}`
        : "Combat tracker",
      onclick: () => { this.tab = "combat"; this.render(); },
    }, [icon("swords", 15)]);

    const settingsBtn = el("button", {
      class: "icon-btn", title: "Settings",
      onclick: () => { this.view = "settings"; this.render(); },
    }, [icon("settings", 15)]);

    const kids: (HTMLElement | null)[] = [pinBtn, partyBtn, combatBtn, settingsBtn];
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
        onclick: () => this.openCatalog(group),
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

    // A question like "I fall off my horse" gets the walkthrough offered
    // above the raw hits — that is the answer they actually wanted.
    for (const flow of searchFlows(this.query, this.flows)) {
      body.append(el("button", {
        class: "flow-banner",
        onclick: () => this.openFlow(flow),
      }, [
        icon("flow", 18),
        el("div", { class: "flow-banner-text" }, [
          el("span", { class: "flow-banner-title", text: flow.title }),
          el("span", { class: "flow-banner-sub", text: `Walk it through · ${flow.steps.length} steps` }),
        ]),
      ]));
    }

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
          this.picture(match.rule, 34),
          el("div", { class: "row-main" }, [
            el("span", { class: "row-title" }, highlighted(match.rule.title, range)),
            el("span", { class: "row-sub" }, [
              match.rule.subtitle ?? "",
              match.rule.source
                ? el("span", { class: "src-tag", text: this.sourcesById.get(match.rule.source)?.name ?? match.rule.source })
                : null,
            ]),
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

  /**
   * Each licence we ship under requires its own notice, so the footer shows
   * the one belonging to whatever is on screen rather than a single blanket
   * line that would be wrong for two thirds of the corpus.
   */
  private footer(rule?: Rule | null): HTMLElement {
    const source = rule?.source ? this.sourcesById.get(rule.source) : undefined;
    return el("div", { class: "footer", text: source?.attribution ?? SRD_ATTRIBUTION });
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
        prose(entry.desc, (expr) => this.doRoll(expr)),
      ])
    ));
  }

  private renderDetailBody(rule: Rule): HTMLElement {
    const body = el("div", { class: "body" });

    const source = rule.source ? this.sourcesById.get(rule.source) : undefined;
    const head = el("div", { class: "detail-head" }, [
      el("div", { class: "detail-top" }, [
        this.picture(rule, 64),
        el("div", { class: "detail-titles" }, [
          el("span", {
            class: "kicker",
            text: `${GROUP_LABELS[rule.group]} · ${source?.name ?? "SRD 5.1"}`,
          }),
          el("h1", { class: "detail-title", text: rule.title }),
          rule.subtitle ? el("span", { class: "detail-sub", text: rule.subtitle }) : null,
        ]),
      ]),
      this.ownershipRow(rule),
    ]);
    if (rule.tldr) {
      head.append(el("div", { style: "margin-top:10px" }, [
        el("button", {
          class: `explain-toggle${this.explain ? " on" : ""}`,
          text: this.explain ? "Show full rule" : "Explain simply",
          onclick: () => { this.explain = !this.explain; this.render(); },
        }),
      ]));
    }
    body.append(head);

    if (this.explain && rule.tldr) {
      body.append(el("div", { class: "explain" }, [
        el("span", { class: "label", text: "TL;DR" }),
        prose(rule.tldr, (expr) => this.doRoll(expr)),
        rule.example ? el("div", { class: "explain-example", text: rule.example }) : null,
      ]));
    }

    const actions = this.quickActions(rule);
    const pinned = this.pins.includes(rule.id);
    body.append(el("div", { class: "qa" }, [
      el("span", { class: "label", text: "Quick actions" }),
      el("div", { class: "qa-list" }, [
        ...actions.map((action) =>
          el("button", {
            class: "qa-btn",
            onclick: () => this.runAction(action),
          }, [icon(this.actionIcon(action), 14), action.label])
        ),
        el("button", {
          class: "qa-btn",
          onclick: async () => { this.pins = await togglePin(rule.id); this.render(); },
        }, [icon("pin", 14), pinned ? "Unpin from session" : "Pin for this session"]),
        el("button", {
          class: "qa-btn",
          onclick: () => this.addToCombat(rule),
        }, [icon("swords", 14), rule.monster ? "Add to combat" : "Open combat tracker"]),
      ]),
    ]));

    if (rule.monster) body.append(...this.renderMonster(rule));
    else if (rule.spell) body.append(...this.renderSpell(rule));
    else body.append(...this.renderProse(rule));

    body.append(...this.renderGraph(rule));
    return body;
  }

  /**
   * Everything published is read-only. Nothing in the panel edits a bundled
   * entry, and this is what says so out loud — the alternative is a reader
   * hunting for an edit control that was never going to exist.
   */
  private isLocked(rule: Rule): boolean {
    return (rule.source ?? SRD_SOURCE_ID) !== HOMEBREW_SOURCE_ID;
  }

  private openEditor(ruleId?: string) {
    openTab(chrome.runtime.getURL(`party.html#homebrew${ruleId ? `:${ruleId}` : ""}`));
  }

  /**
   * Locked entries can still be a starting point: this copies one into your
   * homebrew, where it is yours to change. The original is untouched.
   */
  private async copyToHomebrew(rule: Rule) {
    // Copy what is on screen, not what is on disk: if the stepper has the
    // monster at CR 5, that is the creature being copied.
    const scaled = rule.monster && this.scaleDelta
      ? scaleStatBlock(rule.monster, this.scaleDelta)
      : rule.monster;
    const suffix = rule.monster && this.scaleDelta ? ` (CR ${scaled!.cr})` : " (copy)";

    const copy: Rule = {
      ...structuredClone(rule),
      ...(scaled ? { monster: structuredClone(scaled) } : {}),
      id: newHomebrewId(),
      source: HOMEBREW_SOURCE_ID,
      title: `${rule.title}${suffix}`,
      // seeAlso and quick actions point into the bundled graph by id; a copy
      // keeping them would look like it owned links it does not.
      seeAlso: undefined,
      actions: undefined,
    };
    this.setHomebrew(await upsertHomebrew(copy));
    // The copy's stat block already *is* the scaled one; leaving the stepper
    // where it was would scale it a second time on screen.
    this.scaleDelta = 0;
    this.open(this.rulesById.get(copy.id) ?? copy);
    this.openEditor(copy.id);
  }

  /** Your own entries, all in one place, with the controls the panel allows. */
  private renderHomebrewTab(): HTMLElement {
    const body = el("div", { class: "body" });

    body.append(el("div", { class: "hb-bar" }, [
      el("span", { class: "hb-bar-title", text: this.homebrew.length
        ? `${this.homebrew.length} ${this.homebrew.length === 1 ? "entry" : "entries"} of your own`
        : "Your own entries" }),
      el("button", {
        class: "qa-btn",
        onclick: () => this.openEditor(),
      }, [icon("plus", 13), "New entry"]),
    ]));

    if (!this.homebrew.length) {
      body.append(el("div", { class: "empty", text: "Nothing of your own yet. Anything you write joins the search, the catalogue and the combat tracker alongside the published entries — and stays editable, which they are not." }));
      return body;
    }

    for (const group of RULE_GROUPS) {
      const inGroup = this.homebrew.filter((r) => r.group === group);
      if (!inGroup.length) continue;

      body.append(el("div", { class: "group-head" }, [
        el("span", { text: GROUP_LABELS[group] }),
        el("span", { text: String(inGroup.length) }),
      ]));

      for (const rule of inGroup) {
        body.append(el("div", { class: "hb-row" }, [
          el("button", {
            class: "hb-open",
            onclick: () => { this.tab = "search"; this.open(rule); },
          }, [
            this.picture(rule, 34),
            el("div", { class: "row-main" }, [
              el("span", { class: "row-title", text: rule.title || "Untitled" }),
              el("span", { class: "row-sub", text: rule.subtitle ?? rule.category }),
            ]),
          ]),
          rule.monster
            ? el("button", {
                class: "mini-btn", text: "To combat",
                title: `Add ${rule.title} to the tracker`,
                onclick: () => { this.addToCombat(rule); this.render(); },
              })
            : null,
          el("button", {
            class: "mini-btn", text: "Edit",
            onclick: () => this.openEditor(rule.id),
          }),
          el("button", {
            class: "icon-btn", title: `Delete ${rule.title}`,
            onclick: async () => {
              if (!confirm(`Delete ${rule.title || "this entry"}? This cannot be undone.`)) return;
              this.setHomebrew(await removeHomebrew(rule.id));
              this.render();
            },
          }, [icon("trash", 13)]),
        ]));
      }
    }

    return body;
  }

  /** An entry's picture: their own upload if set, otherwise the emblem. */
  private picture(rule: Rule, size: number): HTMLElement {
    return emblem(rule, { size, portrait: this.portraits[rule.id] });
  }

  /**
   * A fighter's picture. Monsters borrow their bestiary entry's; party members
   * are keyed on their own id, so a character can carry a portrait even though
   * they are nobody's catalogue entry.
   */
  private fighterPicture(c: Combatant, size: number): HTMLElement {
    const rule = c.ruleId ? this.rulesById.get(c.ruleId) : undefined;
    if (rule) return this.picture(rule, size);
    const key = characterPortraitKey(c.characterId ?? c.id);
    return emblemFor(key, c.isPlayer ? "humanoid" : "monstrosity", {
      size, portrait: this.portraits[key],
    });
  }

  /**
   * Says who owns the entry and what can be done to it. Published entries are
   * locked: their text and stats are the published text and stats, and the
   * panel has no way to change them. Your own carry edit and delete instead.
   * A picture is yours either way — it sits over the entry rather than in it.
   */
  private ownershipRow(rule: Rule): HTMLElement {
    const locked = this.isLocked(rule);
    const pack = this.sourcesById.get(rule.source ?? SRD_SOURCE_ID)?.name ?? "SRD 5.1";

    return el("div", { class: "own-row" }, [
      locked
        ? el("span", { class: "lock-chip", title: `${pack} is published content and cannot be edited here.` },
            [icon("lock", 11), `${pack} · locked`])
        : el("span", { class: "own-chip" }, [icon("pencil", 11), "Yours · editable"]),
      locked
        ? el("button", {
            class: "portrait-btn",
            title: "Copy this into your homebrew, where you can change it",
            onclick: () => void this.copyToHomebrew(rule),
          }, [icon("plus", 13), "Copy to my homebrew"])
        : el("button", {
            class: "portrait-btn",
            onclick: () => this.openEditor(rule.id),
          }, [icon("pencil", 13), "Edit entry"]),
      this.portraitControls(rule),
    ]);
  }

    /**
   * Lets the reader drop their own art onto an entry. Nothing ships with the
   * extension — the picture lives in chrome.storage.local on this machine, so
   * whatever they paste in stays theirs and stays offline.
   */
  private portraitControls(rule: Rule): HTMLElement {
    const mine = Boolean(this.portraits[rule.id]);
    const failed = this.portraitError;
    // The message belongs to the upload that just failed, not the next entry.
    this.portraitError = "";

    const file = el("input", { type: "file", accept: "image/*", class: "visually-hidden" });
    file.addEventListener("change", async () => {
      const picked = file.files?.[0];
      file.value = "";
      if (!picked) return;
      try {
        this.portraits = await setPortrait(rule.id, await fileToDataUrl(picked));
      } catch {
        this.portraitError = "Could not read that image — try a PNG or JPEG.";
      }
      this.render();
    });

    return el("div", { class: "portrait-tools" }, [
      file,
      el("button", {
        class: "portrait-btn",
        onclick: () => file.click(),
      }, [icon("plus", 13), mine ? "Replace picture" : "Add picture"]),
      mine
        ? el("button", {
            class: "portrait-btn",
            onclick: async () => {
              this.portraits = await removePortrait(rule.id);
              this.render();
            },
          }, [icon("trash", 13), "Remove"])
        : null,
      failed ? el("span", { class: "portrait-err", text: failed }) : null,
    ]);
  }

  private actionIcon(action: QuickAction): "dice" | "rules" | "flow" | "diamond" {
    if (action.kind === "roll" || action.kind === "check" || action.kind === "perUnit") return "dice";
    if (action.kind === "rule") return "rules";
    if (action.kind === "flow") return "flow";
    return "diamond";
  }

  /**
   * Authored actions where they exist, plus generic ones derived from the
   * entry itself — a monster's attacks are rollable without anyone having
   * hand-written a button for them.
   */
  private quickActions(rule: Rule): QuickAction[] {
    const actions: QuickAction[] = [...(rule.actions ?? [])];

    const scaled = rule.monster ? scaleStatBlock(rule.monster, this.scaleDelta) : undefined;
    for (const attack of scaled?.actions ?? []) {
      if (attack.value?.startsWith("+")) {
        actions.push({ kind: "roll", label: `${attack.name} ${attack.value}`, expr: `1d20 ${attack.value}` });
      }
    }
    return actions.slice(0, 8);
  }

  /** Drops a monster straight into the tracker, rolling its initiative. */
  private addToCombat(rule: Rule) {
    if (!rule.monster) { this.tab = "combat"; this.render(); return; }

    const scaled = scaleStatBlock(rule.monster, this.scaleDelta);
    const existing = this.encounter.combatants.filter((c) => c.ruleId === rule.id).length;
    const suffix = [
      existing ? String(existing + 1) : "",
      this.scaleDelta ? `(CR ${scaled.cr})` : "",
    ].filter(Boolean).join(" ");

    const combatant = combatantFromMonster({ ...rule, monster: scaled }, suffix || undefined);
    combatant.initiative = roll("1d20").total + Math.floor((scaled.abilities.dex - 10) / 2);

    void this.updateEncounter({
      ...this.encounter,
      combatants: [...this.encounter.combatants, combatant],
    });
    this.tab = "combat";
  }

  /**
   * The rules graph: direct cross-references plus anything pointing back at
   * this entry, so related rules are reachable from either end.
   */
  private renderGraph(rule: Rule): HTMLElement[] {
    const linked = new Set(rule.seeAlso ?? []);
    for (const other of this.rules) {
      if (other.seeAlso?.includes(rule.id)) linked.add(other.id);
    }
    linked.delete(rule.id);
    if (!linked.size) return [];

    const related = Array.from(linked)
      .map((id) => this.rulesById.get(id))
      .filter((r): r is Rule => !!r)
      .slice(0, 10);
    if (!related.length) return [];

    const flows = this.flows.filter((f) => f.steps.some((s) => s.ruleId === rule.id));

    const out = [el("div", { class: "qa" }, [
      el("span", { class: "label", text: "Related rules" }),
      el("div", { class: "qa-list" }, related.map((r) =>
        el("button", { class: "qa-btn", onclick: () => this.open(r) }, [icon("rules", 14), r.title])
      )),
    ])];

    if (flows.length) {
      out.push(el("div", { class: "qa" }, [
        el("span", { class: "label", text: "Walkthroughs using this rule" }),
        el("div", { class: "qa-list" }, flows.map((f) =>
          el("button", { class: "qa-btn", onclick: () => this.openFlow(f) }, [icon("flow", 14), f.prompt])
        )),
      ]));
    }
    return out;
  }

  private renderMonster(rule: Rule): HTMLElement[] {
    const base = rule.monster!;
    const m = scaleStatBlock(base, this.scaleDelta);
    const out: HTMLElement[] = [];

    const step = (by: number) =>
      el("button", {
        class: "mini-btn",
        text: by > 0 ? "+" : "−",
        "aria-label": by > 0 ? "scale up" : "scale down",
        onclick: () => {
          this.scaleDelta = Math.max(-6, Math.min(10, this.scaleDelta + by));
          this.render();
        },
      });

    out.push(el("div", { class: "scaler" }, [
      el("span", { class: "stat-k", text: "Scale" }),
      el("div", { class: "stepper" }, [
        step(-1),
        el("span", { class: "value", text: this.scaleDelta > 0 ? `+${this.scaleDelta}` : String(this.scaleDelta) }),
        step(1),
      ]),
      el("span", { class: "stat-k", text: `CR ${base.cr} → ${m.cr}` }),
      this.scaleDelta
        ? el("button", {
            class: "mini-btn", text: "Reset",
            onclick: () => { this.scaleDelta = 0; this.render(); },
          })
        : null,
      this.scaleDelta
        ? el("span", {
            class: "note",
            text: "Approximate homebrew scaling — HP, AC, attack bonuses, save DCs and damage dice are adjusted. The SRD has no official rules for this.",
          })
        : null,
    ]));

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
            prose(a.desc, (expr) => this.doRoll(expr, `${rule.title} — ${a.name}`)),
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
    out.push(el("div", { class: "section-body" }, [prose(rule.body, (expr) => this.doRoll(expr, rule.title))]));
    if (s.higherLevel) {
      out.push(...this.section("higher", "At higher levels", null, () => [
        el("div", { class: "section-body" }, [prose(s.higherLevel!, (expr) => this.doRoll(expr, rule.title))]),
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
    return [...meta, el("div", { class: "section-body" }, [prose(rule.body, (expr) => this.doRoll(expr, rule.title))])];
  }

  // ----------------------------------------------------------- catalog --
  private openCatalog(group: RuleGroup) {
    this.catalogGroup = group;
    this.catalogFilter = {};
    this.catalogSort = group === "bestiary" ? "cr" : group === "spells" ? "level" : "name";
    this.catalogShown = CATALOG_PAGE;
    this.view = "catalog";
    this.render();
  }

  private catalogEntries(): Rule[] {
    const pool = this.rules.filter(
      (r) => r.group === this.catalogGroup
        && this.settings.packs[r.source ?? "srd"] !== false
        && matchesFilter(r, this.catalogFilter)
    );

    const sorters: Record<SortKey, (a: Rule, b: Rule) => number> = {
      name: (a, b) => a.title.localeCompare(b.title),
      cr: (a, b) => crValue(a.monster?.cr ?? "0") - crValue(b.monster?.cr ?? "0"),
      ac: (a, b) => (a.monster?.ac ?? 0) - (b.monster?.ac ?? 0),
      hp: (a, b) => (a.monster?.hp ?? 0) - (b.monster?.hp ?? 0),
      level: (a, b) =>
        (a.spell?.level ?? a.feature?.level ?? 0) - (b.spell?.level ?? b.feature?.level ?? 0),
    };

    return pool.sort((a, b) => sorters[this.catalogSort](a, b) || a.title.localeCompare(b.title));
  }

  private setFilter(patch: Partial<StatFilter>) {
    this.catalogFilter = { ...this.catalogFilter, ...patch };
    this.catalogShown = CATALOG_PAGE;
    this.render();
  }

  /** A min/max pair; blank means "no bound on this end". */
  private rangeRow(label: string, key: "cr" | "ac" | "hp" | "level", step = 1): HTMLElement {
    const range = this.catalogFilter[key] ?? {};
    const box = (which: "min" | "max", placeholder: string) =>
      el("input", {
        type: "number", step: String(step), placeholder,
        value: range[which] === undefined ? "" : String(range[which]),
        "aria-label": `${label} ${which}`,
        oninput: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value;
          const next = { ...range, [which]: raw === "" ? undefined : Number(raw) };
          this.catalogFilter = {
            ...this.catalogFilter,
            [key]: next.min === undefined && next.max === undefined ? undefined : next,
          };
          this.catalogShown = CATALOG_PAGE;
          // List-only refresh: a full re-render would rebuild this input
          // mid-keystroke and drop the caret before the second digit.
          this.renderCatalogListOnly();
        },
      });

    return el("div", { class: "filter-row" }, [
      el("span", { class: "stat-k", text: label }),
      box("min", "min"), el("span", { text: "–" }), box("max", "max"),
    ]);
  }

  private selectRow(
    label: string, value: string | undefined, options: string[], onPick: (next?: string) => void
  ): HTMLElement {
    const select = el("select", {
      "aria-label": label,
      onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value || undefined),
    }, [
      el("option", { value: "", text: `Any ${label.toLowerCase()}` }),
      ...options.map((o) => el("option", { value: o, text: o })),
    ]);
    select.value = value ?? "";
    return el("div", { class: "filter-row" }, [el("span", { class: "stat-k", text: label }), select]);
  }

  private renderCatalogFilters(): HTMLElement {
    const group = this.catalogGroup;
    const rows: HTMLElement[] = [];

    const nameInput = el("input", {
      type: "text", placeholder: "Filter by name…",
      value: this.catalogFilter.name ?? "",
      "aria-label": "name filter",
      oninput: (e: Event) => {
        const value = (e.target as HTMLInputElement).value;
        this.catalogFilter = { ...this.catalogFilter, name: value || undefined };
        this.catalogShown = CATALOG_PAGE;
        this.renderCatalogListOnly();
      },
    });
    rows.push(el("div", { class: "filter-row" }, [nameInput]));

    const uniques = (pick: (r: Rule) => string | undefined) =>
      Array.from(new Set(this.rules.filter((r) => r.group === group).map(pick).filter(Boolean) as string[]))
        .sort();

    if (group === "bestiary") {
      rows.push(this.rangeRow("CR", "cr", 0.25));
      rows.push(this.rangeRow("AC", "ac"));
      rows.push(this.rangeRow("HP", "hp"));
      rows.push(this.selectRow("Type", this.catalogFilter.type, uniques((r) => r.category),
        (type) => this.setFilter({ type })));
    } else if (group === "spells") {
      rows.push(this.rangeRow("Level", "level"));
      rows.push(this.selectRow("School", this.catalogFilter.school,
        uniques((r) => r.spell?.school), (school) => this.setFilter({ school })));
      rows.push(el("div", { class: "filter-row" }, [
        el("button", {
          class: `chip${this.catalogFilter.concentration ? " on" : ""}`,
          text: "Concentration",
          onclick: () => this.setFilter({ concentration: this.catalogFilter.concentration ? undefined : true }),
        }),
        el("button", {
          class: `chip${this.catalogFilter.ritual ? " on" : ""}`,
          text: "Ritual",
          onclick: () => this.setFilter({ ritual: this.catalogFilter.ritual ? undefined : true }),
        }),
      ]));
    } else if (group === "items") {
      rows.push(this.selectRow("Rarity", this.catalogFilter.rarity,
        ["common", "uncommon", "rare", "very rare", "legendary", "artifact"],
        (rarity) => this.setFilter({ rarity })));
    } else if (group === "classes") {
      rows.push(this.rangeRow("Level", "level"));
    }

    const sorts: SortKey[] = group === "bestiary"
      ? ["name", "cr", "ac", "hp"]
      : group === "spells" || group === "classes" ? ["name", "level"] : ["name"];

    if (sorts.length > 1) {
      const select = el("select", {
        "aria-label": "sort",
        onchange: (e: Event) => {
          this.catalogSort = (e.target as HTMLSelectElement).value as SortKey;
          this.render();
        },
      }, sorts.map((s) => el("option", { value: s, text: `Sort by ${s.toUpperCase()}` })));
      select.value = this.catalogSort;
      rows.push(el("div", { class: "filter-row" }, [
        el("span", { class: "stat-k", text: "Sort" }), select,
      ]));
    }

    return el("div", { class: "filters" }, rows);
  }

  /**
   * The name filter re-renders only the list, so the text field keeps focus
   * and the caret while you type into it.
   */
  private renderCatalogListOnly() {
    const body = this.root.querySelector(".body");
    const count = this.root.querySelector(".catalog-count");
    if (!body || !count) { this.render(); return; }
    const fresh = this.renderCatalogBody();
    body.replaceWith(fresh.body);
    count.replaceWith(fresh.count);
  }

  private renderCatalogBody(): { count: HTMLElement; body: HTMLElement } {
    const entries = this.catalogEntries();
    const shown = entries.slice(0, this.catalogShown);

    const count = el("div", { class: "catalog-count" }, [
      el("span", { text: `${entries.length} of ${this.counts[this.catalogGroup]}` }),
      isFilterActive(this.catalogFilter)
        ? el("button", {
            class: "mini-btn", text: "Clear filters", style: "margin-left:auto",
            onclick: () => { this.catalogFilter = {}; this.catalogShown = CATALOG_PAGE; this.render(); },
          })
        : null,
    ]);

    const body = el("div", { class: "body" });
    if (!entries.length) {
      body.append(el("div", { class: "empty", text: "Nothing matches those filters." }));
      return { count, body };
    }

    for (const rule of shown) {
      body.append(el("button", { class: "row", onclick: () => this.open(rule) }, [
        this.picture(rule, 34),
        el("div", { class: "row-main" }, [
          el("span", { class: "row-title", text: rule.title }),
          rule.subtitle ? el("span", { class: "row-sub", text: rule.subtitle }) : null,
        ]),
        rule.badge ? el("span", { class: "row-badge", text: rule.badge }) : null,
      ]));
    }

    if (entries.length > shown.length) {
      body.append(el("button", {
        class: "more-btn",
        text: `Show ${Math.min(CATALOG_PAGE, entries.length - shown.length)} more`,
        onclick: () => { this.catalogShown += CATALOG_PAGE; this.renderCatalogListOnly(); },
      }));
    }
    return { count, body };
  }

  private renderCatalog(): DocumentFragment {
    const frag = document.createDocumentFragment();
    const { count, body } = this.renderCatalogBody();
    frag.append(this.renderCatalogFilters(), count, body);
    return frag;
  }

  // -------------------------------------------------------------- flow --
  private renderFlow(flow: Flow): HTMLElement {
    const body = el("div", { class: "body" });

    body.append(el("div", { class: "detail-head" }, [
      el("span", { class: "kicker", text: "Walkthrough" }),
      el("h1", { class: "detail-title", text: flow.title }),
      el("span", { class: "detail-sub", text: `“${flow.prompt}”` }),
    ]));

    flow.steps.forEach((step, i) => {
      const buttons: HTMLElement[] = [];

      if (step.roll) {
        buttons.push(el("button", {
          class: "qa-btn",
          onclick: () => this.doRoll(step.roll!.expr, step.roll!.label),
        }, [icon("dice", 14), step.roll.label]));
      }
      if (step.perUnit) {
        buttons.push(el("button", {
          class: "qa-btn",
          onclick: () => this.runAction({ kind: "perUnit", ...step.perUnit! }),
        }, [icon("dice", 14), step.perUnit.label]));
      }
      const rule = step.ruleId ? this.rulesById.get(step.ruleId) : undefined;
      if (rule) {
        buttons.push(el("button", {
          class: "qa-btn",
          onclick: () => this.open(rule),
        }, [icon("rules", 14), rule.title]));
      }

      const main = el("div", { class: "step-main" }, [
        el("span", { class: "step-title", text: step.title }),
        step.detail ? prose(step.detail, (expr) => this.doRoll(expr)) : null,
        buttons.length ? el("div", { class: "step-actions" }, buttons) : null,
      ]);

      const applied = (step.applies ?? [])
        .map((id) => this.rulesById.get(id))
        .filter((r): r is Rule => !!r);
      if (applied.length) {
        main.append(el("div", { class: "applies" }, [
          el("span", { class: "label", text: "Now applies" }),
          ...applied.map((r) =>
            el("button", { class: "cond-chip", text: r.title, onclick: () => this.open(r) })
          ),
        ]));
      }

      body.append(el("div", { class: "step" }, [
        el("span", { class: "step-n", text: String(i + 1) }),
        main,
      ]));
    });

    return body;
  }

  // ------------------------------------------------------------ combat --
  private renderCombat(): HTMLElement {
    const body = el("div", { class: "body" });
    const list = ordered(this.encounter);
    const active = activeCombatant(this.encounter);
    const started = this.encounter.started;

    body.append(el("div", { class: "combat-bar" }, [
      el("span", {
        class: "combat-round",
        text: started ? `Round ${this.encounter.round}` : "Not started",
      }),
      el("span", { class: "spacer" }),
      started ? el("button", {
        text: "Prev", onclick: () => void this.updateEncounter(advance(this.encounter, -1)),
      }) : null,
      started ? el("button", {
        text: "End turn", onclick: () => void this.updateEncounter(advance(this.encounter, 1)),
      }) : null,
    ]));

    if (started && active) {
      const speed = effectiveSpeed(active);
      const blocked = !canAct(active);
      body.append(el("div", { class: `turn-banner${blocked ? " blocked" : ""}` }, [
        el("span", { class: "turn-name", text: `${active.name}'s turn` }),
        el("div", { class: "turn-pips" }, [
          el("span", { class: `pip-tag${active.actionUsed ? " used" : ""}`, text: "Action" }),
          el("span", { class: `pip-tag${active.bonusUsed ? " used" : ""}`, text: "Bonus" }),
          el("span", { class: `pip-tag${active.reactionUsed ? " used" : ""}`, text: "Reaction" }),
          el("span", {
            class: `pip-tag${speed === 0 ? " used" : ""}`,
            text: `${Math.max(0, speed - active.movementUsed)} ft`,
          }),
        ]),
        blocked
          ? el("span", {
              class: "turn-note",
              text: `Can't act — ${active.hp <= 0 ? "at 0 HP" : active.conditions.join(", ")}`,
            })
          : null,
      ]));
    }

    body.append(el("div", { class: "qa" }, [
      el("div", { class: "qa-list" }, [
        el("button", {
          class: "qa-btn",
          onclick: () => { this.combatPicker = !this.combatPicker; this.render(); },
        }, [icon("plus", 14), "Add combatant"]),
        el("button", {
          class: "qa-btn",
          onclick: () => {
            if (!this.encounter.combatants.length) return;
            const { encounter, rolls } = rollInitiativeForAll(this.encounter);
            this.lastRoll = rolls[0] ?? this.lastRoll;
            void this.updateEncounter(encounter);
          },
        }, [icon("dice", 14), started ? "Reroll initiative" : "Roll initiative for all"]),
        el("button", {
          class: `qa-btn${this.encounter.dmOverride ? " on" : ""}`,
          title: "Let anyone act, regardless of whose turn it is",
          onclick: () => void this.updateEncounter({
            ...this.encounter, dmOverride: !this.encounter.dmOverride,
          }),
        }, [icon("settings", 14), this.encounter.dmOverride ? "Turn order off" : "Turn order on"]),
        el("button", {
          class: "qa-btn",
          onclick: () => void this.updateEncounter(EMPTY_ENCOUNTER),
        }, [icon("trash", 14), "End encounter"]),
      ]),
    ]));

    if (this.combatPicker) body.append(this.renderCombatPicker());

    if (!list.length) {
      body.append(el("div", {
        class: "empty",
        text: "No one in the fight yet. Add your party, or open a monster and use “Add to combat”.",
      }));
      return body;
    }

    // Grouped by side rather than strictly by initiative. The turn banner
    // names whose turn it is and every row keeps its order number, so the
    // sequence is still readable — while "how is my side doing" stops being
    // a scan through interleaved rows.
    const rows = list.map((c, index) => ({ c, index }));
    const sides = [
      { key: "allies", label: "Characters", rows: rows.filter((r) => r.c.isPlayer) },
      { key: "foes", label: "Enemies", rows: rows.filter((r) => !r.c.isPlayer) },
    ];

    for (const side of sides) {
      if (!side.rows.length) continue;
      const standing = side.rows.filter((r) => !isDead(r.c) && r.c.hp > 0).length;
      body.append(el("div", { class: `group-head side-${side.key}` }, [
        el("span", { text: side.label }),
        el("span", {
          text: standing === side.rows.length
            ? String(side.rows.length)
            : `${standing} of ${side.rows.length} up`,
        }),
      ]));
      for (const { c, index } of side.rows) {
        body.append(this.renderCombatant(c, started ? index === this.encounter.turn : false, index));
      }
    }

    if (this.encounter.log.length) {
      body.append(el("div", { class: "group-head" }, [
        el("span", { text: "Combat log" }),
        el("span", { text: String(this.encounter.log.length) }),
      ]));
      for (const event of this.encounter.log.slice(0, 12)) {
        body.append(el("div", { class: `log-line ${event.kind}` }, [
          el("span", { text: event.text }),
          event.detail ? el("span", { class: "roll-detail", text: event.detail }) : null,
        ]));
      }
    }
    return body;
  }

  private renderCombatPicker(): HTMLElement {
    const rows: HTMLElement[] = [];

    for (const character of this.party) {
      rows.push(el("button", {
        class: "qa-btn",
        onclick: () => {
          const combatant = combatantFromCharacter(character, this.rulesById);
          combatant.initiative = roll("1d20").total + Math.floor((character.abilities.dex - 10) / 2);
          this.combatPicker = false;
          void this.updateEncounter({
            ...this.encounter,
            combatants: [...this.encounter.combatants, combatant],
          });
        },
      }, [
        icon("classes", 14),
        `${character.name}${character.className ? ` · ${character.className} ${character.level}` : ""}`,
      ]));
    }

    rows.push(el("button", {
      class: "qa-btn",
      onclick: () => {
        const name = prompt("Name this combatant");
        if (!name) return;
        this.combatPicker = false;
        void this.updateEncounter({
          ...this.encounter,
          combatants: [...this.encounter.combatants, combatantBlank(name)],
        });
      },
    }, [icon("plus", 14), "Blank combatant"]));

    return el("div", { class: "qa" }, [
      el("span", {
        class: "label",
        text: this.party.length
          ? "Add from your party — their weapons, spells and items come with them"
          : "No party saved yet — create one from settings",
      }),
      el("div", { class: "qa-list" }, rows),
    ]);
  }

  /** Resolves one action against one target and writes the consequences. */
  private async useAction(attacker: Combatant, action: CombatAction, target: Combatant) {
    const result = resolveAction(attacker, action, target, this.attackMode);
    const primary = result.attackRoll ?? result.save?.roll ?? result.damage;
    if (primary) { this.lastRoll = primary; void pushRoll(primary); }

    let headline: string;
    if (result.save) {
      const { dc, ability, roll: saveRoll, passed } = result.save;
      headline =
        `${attacker.name} → ${target.name}: ${action.name} — DC ${dc} ${ability.toUpperCase()} save ` +
        `${saveRoll.total} (${passed ? "saved" : "failed"})`;
    } else if (result.attackRoll) {
      const verdict = result.crit ? "CRIT" : result.fumble ? "natural 1" : result.hit ? "hit" : "miss";
      headline =
        `${attacker.name} → ${target.name}: ${action.name} ${result.attackRoll.total} ` +
        `vs AC ${target.ac} — ${verdict}`;
    } else {
      headline = `${attacker.name} → ${target.name}: ${action.name}`;
    }

    const detailBits: string[] = [];
    if (result.damage) {
      detailBits.push(`${result.damageTotal} ${action.damageType ?? ""} damage`.replace("  ", " ").trim());
      detailBits.push(`(${result.damage.expr} ${formatRoll(result.damage)})`);
    }
    if (result.shape.reasons.length) detailBits.push(`— ${result.shape.reasons.join(", ")}`);

    let encounter = logEvent(this.encounter, {
      kind: "attack",
      text: headline,
      detail: detailBits.join(" ") || undefined,
    });

    if (result.damageTotal > 0) {
      encounter = {
        ...encounter,
        combatants: encounter.combatants.map((x) =>
          x.id === target.id ? applyDamage(x, result.damageTotal) : x
        ),
      };

      if (result.concentration) {
        const { dc, save, held } = result.concentration;
        encounter = logEvent(encounter, {
          kind: "save",
          text: `${target.name} concentration DC ${dc}: ${save.total} — ${held ? "holds" : "broken"}`,
        });
        if (!held) {
          encounter = {
            ...encounter,
            combatants: encounter.combatants.map((x) =>
              x.id === target.id ? { ...x, concentrating: false, concentrationNote: "" } : x
            ),
          };
        }
      }

      const after = encounter.combatants.find((x) => x.id === target.id);
      if (after && after.hp === 0) {
        encounter = logEvent(encounter, {
          kind: "note",
          text: isDead(after)
            ? `${target.name} drops to 0 HP — dead`
            : `${target.name} drops to 0 HP — unconscious and prone, rolling death saves`,
        });
      }
    }

    // Spend the action economy this cost, unless turn order is off.
    if (this.encounter.started && !this.encounter.dmOverride) {
      encounter = {
        ...encounter,
        combatants: encounter.combatants.map((x) =>
          x.id === attacker.id
            ? {
                ...x,
                actionUsed: action.cost === "action" ? true : x.actionUsed,
                bonusUsed: action.cost === "bonus" ? true : x.bonusUsed,
                reactionUsed: action.cost === "reaction" ? true : x.reactionUsed,
              }
            : x
        ),
      };
    }

    this.attackFrom = null;
    await this.updateEncounter(encounter);
  }

  private async adjustHp(c: Combatant, amount: number, heal: boolean) {
    if (!amount) return;
    let encounter: Encounter = {
      ...this.encounter,
      combatants: this.encounter.combatants.map((x) =>
        x.id === c.id ? (heal ? applyHealing(x, amount) : applyDamage(x, amount)) : x
      ),
    };
    encounter = logEvent(encounter, {
      kind: heal ? "heal" : "damage",
      text: `${c.name} ${heal ? "healed" : "takes"} ${amount}${heal ? "" : " damage"}`,
    });

    const hit = encounter.combatants.find((x) => x.id === c.id);
    if (!heal && hit && hit.hp === 0 && c.hp > 0) {
      encounter = logEvent(encounter, {
        kind: "note",
        text: isDead(hit)
          ? `${c.name} drops to 0 HP — dead`
          : `${c.name} drops to 0 HP — unconscious and prone, rolling death saves`,
      });
    }

    // Damage taken outside an attack still threatens a held spell.
    if (!heal && c.concentrating) {
      const dc = Math.max(10, Math.floor(amount / 2));
      const save = rollSave(c, "con");
      const held = save.total >= dc;
      this.lastRoll = save;
      encounter = logEvent(encounter, {
        kind: "save",
        text: `${c.name} concentration DC ${dc}: ${save.total} — ${held ? "holds" : "broken"}`,
      });
      if (!held) {
        encounter = {
          ...encounter,
          combatants: encounter.combatants.map((x) =>
            x.id === c.id ? { ...x, concentrating: false, concentrationNote: "" } : x
          ),
        };
      }
    }

    this.hpDelta.delete(c.id);
    await this.updateEncounter(encounter);
  }

  private costLabel(action: CombatAction): string {
    if (action.cost === "bonus") return "Bonus";
    if (action.cost === "reaction") return "Reaction";
    if (action.cost === "free") return "Free";
    return "Action";
  }

  private renderActionPanel(attacker: Combatant): HTMLElement {
    const targets = ordered(this.encounter).filter((t) => t.id !== attacker.id);
    const gated = this.encounter.started && !this.encounter.dmOverride;

    const modeBtn = (mode: "normal" | "adv" | "dis", label: string) =>
      el("button", {
        class: `mini-btn${this.attackMode === mode ? " on" : ""}`,
        text: label,
        onclick: () => { this.attackMode = mode; this.render(); },
      });

    const rows: HTMLElement[] = [
      el("div", { class: "fighter-row" }, [
        el("span", { class: "stat-k", text: "Roll" }),
        modeBtn("normal", "Normal"), modeBtn("adv", "Adv"), modeBtn("dis", "Dis"),
        el("button", {
          class: "mini-btn", text: "Cancel", style: "margin-left:auto",
          onclick: () => { this.attackFrom = null; this.render(); },
        }),
      ]),
    ];

    if (!attacker.actions.length) {
      rows.push(el("div", { class: "fighter-row" }, [
        el("span", {
          class: "roll-detail",
          text: attacker.isPlayer
            ? "No weapons or spells on this character yet — add them on the party page."
            : "No actions yet — add one below.",
        }),
      ]));
    }

    for (const action of attacker.actions) {
      const spent =
        gated &&
        ((action.cost === "action" && attacker.actionUsed) ||
          (action.cost === "bonus" && attacker.bonusUsed) ||
          (action.cost === "reaction" && attacker.reactionUsed));

      const numbers = [
        action.bonus !== undefined ? `${action.bonus >= 0 ? "+" : ""}${action.bonus} to hit` : null,
        action.saveDC !== undefined
          ? `DC ${action.saveDC} ${action.saveAbility?.toUpperCase() ?? ""}`
          : null,
        action.damage ?? null,
        action.damageType ?? null,
      ].filter(Boolean).join(" · ");

      const rule = action.ruleId ? this.rulesById.get(action.ruleId) : undefined;

      rows.push(el("div", { class: `attack-line${spent ? " spent" : ""}` }, [
        el("div", { class: "attack-head" }, [
          el("span", { class: "attack-name", text: action.name }),
          el("span", { class: "cost-tag", text: this.costLabel(action) }),
          rule
            ? el("button", {
                class: "mini-btn", text: "Rule",
                onclick: () => { this.tab = "search"; this.open(rule); },
              })
            : null,
        ]),
        numbers ? el("span", { class: "roll-detail", text: numbers }) : null,
        spent
          ? el("span", { class: "roll-detail", text: `${this.costLabel(action)} already used this turn` })
          : el("div", { class: "target-list" }, targets.length
              ? targets.map((t) =>
                  el("button", {
                    class: "mini-btn",
                    title: `${action.name} against ${t.name} (AC ${t.ac})`,
                    text: `▸ ${t.name}`,
                    onclick: () => void this.useAction(attacker, action, t),
                  })
                )
              : [el("span", { class: "roll-detail", text: "No other combatants to target." })]),
      ]));
    }

    rows.push(el("div", { class: "fighter-row" }, [
      el("button", {
        class: "mini-btn", text: "+ Add action",
        onclick: () => {
          const name = prompt("Action name (e.g. Longsword)");
          if (!name) return;
          const bonus = parseInt(prompt("Attack bonus, e.g. 5 (blank for a save)", "0") ?? "0", 10);
          const damage = prompt("Damage dice, e.g. 1d8 + 3", "1d6") ?? "1d6";
          this.patchCombatant(attacker.id, {
            actions: [...attacker.actions, {
              id: `a${Date.now().toString(36)}`,
              name, kind: "other", cost: "action",
              bonus: Number.isFinite(bonus) ? bonus : 0,
              damage, melee: true,
            }],
          });
        },
      }),
      ...attacker.actions.map((action, i) =>
        el("button", {
          class: "mini-btn danger",
          title: `Remove ${action.name}`,
          text: `− ${action.name}`,
          onclick: () => this.patchCombatant(attacker.id, {
            actions: attacker.actions.filter((_, j) => j !== i),
          }),
        })
      ),
    ]));

    return el("div", { class: "attack-panel" }, rows);
  }

  private renderCombatant(c: Combatant, isActive: boolean, index: number): HTMLElement {
    const down = c.hp <= 0;
    const dead = isDead(c);
    const gated = this.encounter.started && !this.encounter.dmOverride;
    const canUse = !gated || isActive;
    const blocked = !canAct(c);

    const number = (value: number, onChange: (next: number) => void, label: string) =>
      el("input", {
        class: "num-input", type: "number", value: String(value), "aria-label": label,
        onchange: (e: Event) => onChange(parseInt((e.target as HTMLInputElement).value, 10) || 0),
      });

    const head = el("div", { class: "fighter-head" }, [
      this.encounter.started
        ? el("span", { class: "turn-index", text: String(index + 1) })
        : null,
      this.fighterPicture(c, 26),
      el("span", { class: "fighter-init", text: String(c.initiative) }),
      el("span", { class: `fighter-name${dead ? " dead" : ""}`, text: c.name }),
      dead ? el("span", { class: "fighter-dead", text: "(deceased)" }) : null,
      el("span", { class: `fighter-tag ${c.isPlayer ? "ally" : "foe"}`, text: c.isPlayer ? "PC" : "Enemy" }),
      el("button", {
        class: "icon-btn", title: "Remove",
        style: "margin-left:auto",
        onclick: () => void this.updateEncounter({
          ...this.encounter,
          combatants: this.encounter.combatants.filter((x) => x.id !== c.id),
          order: this.encounter.order.filter((oid) => oid !== c.id),
        }),
      }, [icon("close", 13)]),
    ]);

    const vitals = el("div", { class: "fighter-row" }, [
      el("span", { class: "stat-k", text: "HP" }),
      number(c.hp, (hp) => this.patchCombatant(c.id, { hp }), "hit points"),
      el("span", { text: `/ ${c.maxHp}` }),
      c.tempHp ? el("span", { class: "temp-hp", text: `+${c.tempHp} temp` }) : null,
      el("span", { class: "stat-k", text: "AC" }),
      number(c.ac, (ac) => this.patchCombatant(c.id, { ac }), "armor class"),
      el("span", { class: "stat-k", text: "Init" }),
      number(c.initiative, (initiative) => this.patchCombatant(c.id, { initiative }), "initiative"),
    ]);

    const deltaInput = el("input", {
      class: "num-input", type: "number", min: "0",
      placeholder: "0", "aria-label": `amount for ${c.name}`,
      value: this.hpDelta.get(c.id) ? String(this.hpDelta.get(c.id)) : "",
      oninput: (e: Event) => {
        this.hpDelta.set(c.id, parseInt((e.target as HTMLInputElement).value, 10) || 0);
      },
    });

    const hpControls = el("div", { class: "fighter-row" }, [
      deltaInput,
      el("button", {
        class: "mini-btn", text: "Damage",
        onclick: () => void this.adjustHp(c, this.hpDelta.get(c.id) ?? 0, false),
      }),
      el("button", {
        class: "mini-btn", text: "Heal",
        onclick: () => void this.adjustHp(c, this.hpDelta.get(c.id) ?? 0, true),
      }),
      el("button", {
        class: "mini-btn", text: "Temp",
        title: "Set temporary hit points (they don't stack — the higher wins)",
        onclick: () => {
          const amount = this.hpDelta.get(c.id) ?? 0;
          this.patchCombatant(c.id, { tempHp: Math.max(c.tempHp, amount) });
          this.hpDelta.delete(c.id);
        },
      }),
      el("button", {
        class: `mini-btn${canUse && !blocked ? " on" : ""}`,
        text: `Actions${c.actions.length ? ` (${c.actions.length})` : ""}`,
        style: "margin-left:auto",
        title: blocked
          ? "This combatant can't act right now"
          : canUse ? "Use a weapon, spell or item" : "Not their turn — enable “Turn order off” to act anyway",
        disabled: !canUse || blocked,
        onclick: () => {
          this.attackFrom = this.attackFrom === c.id ? null : c.id;
          this.render();
        },
      }),
    ]);

    const speed = effectiveSpeed(c);
    const movementLeft = Math.max(0, speed - c.movementUsed);
    const statuses = el("div", { class: "fighter-row" }, [
      el("button", {
        class: `mini-btn${c.reactionUsed ? "" : " on"}`,
        title: "Reaction available",
        text: c.reactionUsed ? "Reaction used" : "Reaction ready",
        onclick: () => this.patchCombatant(c.id, { reactionUsed: !c.reactionUsed }),
      }),
      el("span", { class: "stat-k", text: "Move" }),
      el("span", {
        text: speed === 0 ? "0 ft (speed 0)" : `${movementLeft} / ${speed} ft`,
      }),
      el("button", {
        class: "mini-btn", text: "−5",
        onclick: () => this.patchCombatant(c.id, { movementUsed: Math.min(speed, c.movementUsed + 5) }),
      }),
      el("button", {
        class: "mini-btn", text: "Reset",
        onclick: () => this.patchCombatant(c.id, { movementUsed: 0 }),
      }),
    ]);

    const saves = el("div", { class: "fighter-row" }, [
      el("span", { class: "stat-k", text: "Save" }),
      ...ABILITY_KEYS.map((ability) => {
        const bonus = c.saveBonuses[ability] ?? abilityMod(c.abilities[ability]);
        return el("button", {
          class: "mini-btn",
          title: `${ability.toUpperCase()} save ${bonus >= 0 ? "+" : ""}${bonus}`,
          text: ability.toUpperCase(),
          onclick: () => {
            const result = rollSave(c, ability, this.attackMode);
            this.lastRoll = result;
            void pushRoll(result);
            void this.updateEncounter(logEvent(this.encounter, {
              kind: "save",
              text: `${c.name} ${ability.toUpperCase()} save: ${result.total}`,
            }));
          },
        });
      }),
    ]);

    const conc = el("div", { class: "fighter-row" }, [
      el("button", {
        class: `mini-btn${c.concentrating ? " on" : ""}`,
        text: "Concentrating",
        onclick: () => this.patchCombatant(c.id, { concentrating: !c.concentrating }),
      }),
      c.concentrating
        ? el("input", {
            class: "text-input", type: "text", value: c.concentrationNote,
            placeholder: "on what?", "aria-label": "concentration note",
            onchange: (e: Event) =>
              this.patchCombatant(c.id, { concentrationNote: (e.target as HTMLInputElement).value }),
          })
        : null,
    ]);

    const fighter = el("div", {
      class: `fighter ${c.isPlayer ? "ally" : "foe"}${isActive ? " active" : ""}`
        + `${down ? " down" : ""}${dead ? " dead" : ""}`,
    }, [head, vitals, hpControls, statuses, saves, conc]);

    if (this.attackFrom === c.id) fighter.append(this.renderActionPanel(c));

    if (down && c.isPlayer && !dead) {
      const pip = (kind: "succ" | "fail", pipIndex: number, filled: boolean) =>
        el("button", {
          class: `pip ${kind}${filled ? " on" : ""}`,
          "aria-label": `${kind} ${pipIndex + 1}`,
          onclick: () => {
            const key = kind === "succ" ? "successes" : "failures";
            const current = c.deathSaves[key];
            const deathSaves = { ...c.deathSaves, [key]: current === pipIndex + 1 ? pipIndex : pipIndex + 1 };
            this.patchCombatant(c.id, settleDeath({ ...c, deathSaves }));
          },
        });

      fighter.append(el("div", { class: "fighter-row" }, [
        el("span", { class: "stat-k", text: "Death" }),
        el("span", { class: "death-track" },
          [0, 1, 2].map((i) => pip("succ", i, c.deathSaves.successes > i))),
        el("span", { class: "death-track" },
          [0, 1, 2].map((i) => pip("fail", i, c.deathSaves.failures > i))),
        el("button", {
          class: "mini-btn", text: "Roll",
          onclick: () => {
            const result = roll("1d20", { label: `${c.name} — death save` });
            this.lastRoll = result;
            void pushRoll(result);

            const nat = result.dice[0].values[0];
            const patch = { ...c.deathSaves };
            if (nat === 20) {
              void this.updateEncounter(logEvent({
                ...this.encounter,
                combatants: this.encounter.combatants.map((x) =>
                  x.id === c.id
                    ? {
                        ...x, hp: 1, deathSaves: { successes: 0, failures: 0 },
                        conditions: x.conditions.filter((cond) => cond !== "unconscious"),
                      }
                    : x
                ),
              }, { kind: "save", text: `${c.name} death save: natural 20 — back up at 1 HP` }));
              return;
            }
            if (nat === 1) patch.failures = Math.min(3, patch.failures + 2);
            else if (result.total >= 10) patch.successes = Math.min(3, patch.successes + 1);
            else patch.failures = Math.min(3, patch.failures + 1);

            const outcome = patch.failures >= 3 ? " — dead"
              : patch.successes >= 3 ? " — stable, no longer dying" : "";
            void this.updateEncounter(logEvent({
              ...this.encounter,
              combatants: this.encounter.combatants.map((x) =>
                x.id === c.id ? settleDeath({ ...x, deathSaves: patch }) : x
              ),
            }, { kind: "save", text: `${c.name} death save: ${result.total}${outcome}` }));
          },
        }),
      ]));
    }

    const conditions = el("div", { class: "fighter-row" }, [
      ...c.conditions.map((cid) =>
        el("button", {
          class: "cond-chip",
          title: "Remove condition",
          text: this.rulesById.get(cid)?.title ?? cid,
          onclick: () => this.patchCombatant(c.id, { conditions: c.conditions.filter((x) => x !== cid) }),
        })
      ),
      el("select", {
        class: "text-input",
        "aria-label": "add condition",
        onchange: (e: Event) => {
          const select = e.target as HTMLSelectElement;
          if (!select.value) return;
          if (!c.conditions.includes(select.value)) {
            this.patchCombatant(c.id, { conditions: [...c.conditions, select.value] });
          }
          select.value = "";
        },
      }, [
        el("option", { value: "", text: "+ condition" }),
        ...TRACKED_CONDITIONS.filter((cid) => !c.conditions.includes(cid)).map((cid) =>
          el("option", { value: cid, text: this.rulesById.get(cid)?.title ?? cid })
        ),
      ]),
    ]);
    fighter.append(conditions);

    if (c.ruleId) {
      const rule = this.rulesById.get(c.ruleId);
      if (rule) {
        fighter.append(el("div", { class: "fighter-row" }, [
          el("button", {
            class: "mini-btn", text: "Stat block",
            onclick: () => { this.tab = "search"; this.open(rule); },
          }),
        ]));
      }
    }

    return fighter;
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
        this.picture(rule, 24),
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
        rows.push(prose(rule.body.slice(0, 320), (expr) => this.doRoll(expr, rule.title)));
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
          el("span", { class: "label", text: "Content packs" }),
          el("div", { class: "set-list" }, [
            this.packRow({
              id: "srd", name: "D&D SRD 5.1", license: "CC BY 4.0",
              attribution: SRD_ATTRIBUTION,
            }),
            ...this.sources.map((source) => this.packRow(source)),
          ]),
        ]),
        el("div", { class: "set-group" }, [
          el("span", { class: "label", text: "Your content" }),
          el("div", { class: "qa-list" }, [
            el("button", {
              class: "qa-btn",
              onclick: () => openTab(chrome.runtime.getURL("party.html")),
            }, [
              icon("classes", 14),
              this.party.length ? `Your party (${this.party.length})` : "Create your party",
            ]),
            el("button", {
              class: "qa-btn",
              onclick: () => openTab(chrome.runtime.getURL("party.html#homebrew")),
            }, [icon("plus", 14), "Write your own entries"]),
          ]),
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

  private packRow(source: SourceRecord): HTMLElement {
    const on = this.settings.packs[source.id] !== false;
    const count = this.rules.filter((r) => (r.source ?? "srd") === source.id).length;
    return el("label", {
      class: `set-row${on ? "" : " off"}`,
      title: source.attribution,
      onclick: async (e: Event) => {
        e.preventDefault();
        this.settings = await saveSettings({
          packs: { ...this.settings.packs, [source.id]: !on },
        });
        this.render();
      },
    }, [
      el("span", { class: "check" }, [icon("check", 11, 2.5)]),
      el("div", { class: "set-text" }, [
        el("b", { text: source.name }),
        el("span", { text: source.license }),
      ]),
      el("span", { class: "set-count", text: String(count) }),
    ]);
  }

  private renderSettingsFoot(): HTMLElement {
    return el("div", { class: "footbar" }, [
      el("span", { class: "label", text: `Data v5.1 · ${this.rules.length} local` }),
      el("button", {
        class: "btn-primary", text: "Shortcuts",
        onclick: () => openTab("chrome://extensions/shortcuts"),
      }),
    ]);
  }
}
