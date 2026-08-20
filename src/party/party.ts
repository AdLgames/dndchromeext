import { exportContent, importContent, parseContentFile } from "../backup";
import { loadDataset } from "../data/load";
import {
  getHomebrew, newHomebrew, removeHomebrew, saveHomebrew,
} from "../homebrew";
import { getParty, newCharacter, saveParty } from "../party";
import { getSettings, resolveTheme } from "../settings";
import type { AbilityScores, Character, CharacterEntry, Rule, RuleGroup } from "../types";
import { el } from "../ui/dom";
import { emblemFor } from "../ui/emblem";
import {
  characterPortraitKey, fileToDataUrl, getPortraits, removePortrait, setPortrait,
  type Portraits,
} from "../portraits";
import { GROUP_CHOICES, renderHomebrew, type EditorHost } from "./homebrew-editor";

const ABILITY_KEYS: (keyof AbilityScores)[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Which SRD group each list picks from; free text is always allowed too. */
const LISTS: { key: "spells" | "actions" | "items"; label: string; group: RuleGroup | null }[] = [
  { key: "spells", label: "Spells", group: "spells" },
  { key: "actions", label: "Actions & features", group: "classes" },
  { key: "items", label: "Items & equipment", group: "items" },
];

let party: Character[] = [];
let homebrew: Rule[] = [];
let rules: Rule[] = [];
let portraits: Portraits = {};
let tab: "party" | "homebrew" = "party";
/** Characters currently typing a class the packs do not list. */
const customClassOpen = new Set<string>();
const listEl = document.getElementById("list")!;
const statusEl = document.getElementById("status")!;

function status(message: string) {
  statusEl.textContent = message;
  if (message) setTimeout(() => { if (statusEl.textContent === message) statusEl.textContent = ""; }, 4000);
}

let saveTimer: number | undefined;

/**
 * Autosaves on every keystroke rather than on blur. Waiting for `change`
 * meant typing a name and closing the tab lost it, and any list edit
 * re-rendered from stored state over the top of the pending field.
 */
async function persist(immediate = false) {
  clearTimeout(saveTimer);
  statusEl.textContent = "Saving…";
  if (immediate) {
    await saveParty(party);
    status("All changes saved.");
    return;
  }
  saveTimer = setTimeout(async () => {
    await saveParty(party);
    status("All changes saved.");
  }, 250) as unknown as number;
}

let brewTimer: number | undefined;

async function persistHomebrew() {
  clearTimeout(brewTimer);
  statusEl.textContent = "Saving…";
  brewTimer = setTimeout(async () => {
    homebrew = await saveHomebrew(homebrew);
    status("All changes saved.");
  }, 250) as unknown as number;
}

function patch(id: string, changes: Partial<Character>, immediate = false) {
  party = party.map((c) => (c.id === id ? { ...c, ...changes } : c));
  void persist(immediate);
}

function numberCell(label: string, value: number, onChange: (next: number) => void) {
  return el("div", { class: "cell" }, [
    el("span", { class: "stat-k", text: label }),
    el("input", {
      type: "number", value: String(value), "aria-label": label,
      oninput: (e: Event) => onChange(parseInt((e.target as HTMLInputElement).value, 10) || 0),
    }),
  ]);
}

/** Type-ahead over the SRD, with whatever was typed available as free text. */
function renderAdder(character: Character, list: (typeof LISTS)[number]) {
  const input = el("input", {
    class: "text-input", type: "text", placeholder: `Add to ${list.label.toLowerCase()}…`,
  });
  const suggest = el("div", { class: "suggest" });
  suggest.style.display = "none";

  const commit = (entry: CharacterEntry) => {
    patch(character.id, { [list.key]: [...character[list.key], entry] } as Partial<Character>);
    input.value = "";
    suggest.style.display = "none";
    render();
  };

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    suggest.textContent = "";
    if (query.length < 2) { suggest.style.display = "none"; return; }

    // Your own entries are pickable too, so a homebrew sword can sit on a
    // character sheet and resolve in combat like a published one.
    const corpus = [...rules, ...homebrew];
    const pool = list.group ? corpus.filter((r) => r.group === list.group) : corpus;
    const hits = pool
      .filter((r) => r.title.toLowerCase().includes(query))
      // Titles that *start* with the query first, then shortest — otherwise
      // "fireba" offers "Delayed Blast Fireball" ahead of "Fireball".
      .sort((a, b) => {
        const aStarts = a.title.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.title.toLowerCase().startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.title.length - b.title.length || a.title.localeCompare(b.title);
      })
      .slice(0, 8);

    for (const rule of hits) {
      suggest.append(el("button", {
        type: "button",
        onclick: () => commit({ ruleId: rule.id, name: rule.title }),
      }, [
        rule.title,
        rule.subtitle ? el("span", { class: "hint", text: rule.subtitle }) : null,
      ]));
    }

    // Anything not in the SRD — homebrew, a DM's ruling, a custom item.
    suggest.append(el("button", {
      type: "button",
      onclick: () => commit({ name: input.value.trim() }),
    }, [
      `Add “${input.value.trim()}” as custom`,
      el("span", { class: "hint", text: "Free text — not from the SRD" }),
    ]));
    suggest.style.display = "block";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      e.preventDefault();
      commit({ name: input.value.trim() });
    }
    if (e.key === "Escape") suggest.style.display = "none";
  });

  return el("div", { class: "adder" }, [input, suggest]);
}

function renderList(character: Character, list: (typeof LISTS)[number]) {
  const entries = character[list.key];
  return el("div", { class: "list" }, [
    el("span", { class: "label", text: `${list.label} (${entries.length})` }),
    el("ul", {}, entries.map((entry, i) =>
      el("li", {}, [
        el("span", { text: entry.name }),
        entry.ruleId ? null : el("span", { class: "custom", text: "custom" }),
        el("button", {
          class: "mini-btn danger", text: "Remove",
          onclick: () => {
            patch(character.id, {
              [list.key]: entries.filter((_, j) => j !== i),
            } as Partial<Character>);
            render();
          },
        }),
      ])
    )),
    renderAdder(character, list),
  ]);
}

/**
 * The classes the bundled packs actually describe, read off the class
 * features rather than hard-coded, so a pack that adds one is offered too.
 * The same group carries backgrounds and feats, which are not classes.
 */
const NOT_A_CLASS = new Set(["background", "feat"]);

function classNames(): string[] {
  const names = new Set<string>();
  for (const rule of rules) {
    const name = rule.feature?.className;
    if (name && !NOT_A_CLASS.has(name.toLowerCase())) names.add(name);
  }
  return [...names].sort();
}

const CUSTOM = "\u0000custom";

/**
 * Class is a lookup, not free text: spelling it "Wizzard" quietly cost the
 * character their spellcasting ability in combat, which is derived from this
 * field. Anything not in the packs is still allowed — "Other" swaps in a
 * plain text box — it just has to be chosen deliberately.
 */
function renderClassPicker(character: Character) {
  const known = classNames();
  const custom = Boolean(character.className) && !known.includes(character.className);

  if (custom || customClassOpen.has(character.id)) {
    return el("div", { class: "class-pick" }, [
      el("input", {
        class: "text-input", type: "text", value: character.className,
        placeholder: "Class", "aria-label": "class",
        oninput: (e: Event) => patch(character.id, { className: (e.target as HTMLInputElement).value }),
      }),
      el("button", {
        class: "mini-btn", type: "button", text: "Pick from list",
        onclick: () => {
          customClassOpen.delete(character.id);
          patch(character.id, { className: "" });
          render();
        },
      }),
    ]);
  }

  const select = el("select", {
    class: "text-input", "aria-label": "class",
    onchange: (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      if (value === CUSTOM) {
        customClassOpen.add(character.id);
        render();
        return;
      }
      patch(character.id, { className: value });
    },
  }, [
    el("option", { value: "", text: "Class…" }),
    ...known.map((name) => el("option", { value: name, text: name })),
    el("option", { value: CUSTOM, text: "Other…" }),
  ]);
  select.value = character.className;
  return select;
}

/**
 * The character's picture: a generated emblem until someone drops their own
 * art on it. Clicking the picture is the file picker — no separate button,
 * because the picture is the affordance.
 */
function renderPortrait(character: Character) {
  const key = characterPortraitKey(character.id);
  const file = el("input", { type: "file", accept: "image/*", style: "display:none" });
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    file.value = "";
    if (!picked) return;
    try {
      portraits = await setPortrait(key, await fileToDataUrl(picked));
      render();
    } catch {
      status("Could not read that image — try a PNG or JPEG.");
    }
  });

  const button = el("button", {
    class: "portrait-slot",
    title: portraits[key] ? "Change picture" : "Add a picture",
    onclick: () => file.click(),
  }, [emblemFor(key, "humanoid", { size: 52, portrait: portraits[key] })]);

  return el("div", { class: "portrait-wrap" }, [
    button,
    file,
    portraits[key]
      ? el("button", {
          class: "portrait-clear", title: "Remove picture", text: "×",
          onclick: async () => { portraits = await removePortrait(key); render(); },
        })
      : null,
  ]);
}

function renderCharacter(character: Character) {
  const head = el("div", { class: "char-head" }, [
    renderPortrait(character),
    el("input", {
      class: "char-name", type: "text", value: character.name, "aria-label": "character name",
      oninput: (e: Event) => patch(character.id, { name: (e.target as HTMLInputElement).value }),
    }),
    renderClassPicker(character),
    el("button", {
      class: "mini-btn danger", text: "Delete",
      style: "margin-left:auto",
      onclick: () => {
        if (!confirm(`Delete ${character.name}?`)) return;
        party = party.filter((c) => c.id !== character.id);
        void persist();
        render();
      },
    }),
  ]);

  const stats = el("div", { class: "grid" }, [
    numberCell("Level", character.level, (level) => patch(character.id, { level })),
    numberCell("AC", character.ac, (ac) => patch(character.id, { ac })),
    numberCell("HP", character.hp, (hp) => patch(character.id, { hp })),
    numberCell("Max HP", character.maxHp, (maxHp) => patch(character.id, { maxHp })),
    numberCell("Speed", character.speed, (speed) => patch(character.id, { speed })),
  ]);

  const abilities = el("div", { class: "grid" }, ABILITY_KEYS.map((key) =>
    numberCell(key.toUpperCase(), character.abilities[key], (value) =>
      patch(character.id, { abilities: { ...character.abilities, [key]: value } })
    )
  ));

  const notes = el("div", { class: "notes" }, [
    el("span", { class: "label", text: "Notes" }),
    el("textarea", {
      placeholder: "Anything else worth remembering mid-session…",
      "aria-label": "notes",
      oninput: (e: Event) => patch(character.id, { notes: (e.target as HTMLTextAreaElement).value }),
    }),
  ]);
  (notes.querySelector("textarea") as HTMLTextAreaElement).value = character.notes;

  return el("div", { class: "char" }, [
    head, stats, abilities,
    el("div", { class: "lists" }, LISTS.map((list) => renderList(character, list))),
    notes,
  ]);
}

const editorHost: EditorHost = {
  entries: () => homebrew,
  patch: (id, changes) => {
    homebrew = homebrew.map((r) => (r.id === id ? { ...r, ...changes } : r));
    void persistHomebrew();
  },
  add: (group) => {
    homebrew = [...homebrew, newHomebrew(group)];
    void persistHomebrew();
    render();
  },
  remove: (rule) => {
    if (!confirm(`Delete ${rule.title || "this entry"}?`)) return;
    homebrew = homebrew.filter((r) => r.id !== rule.id);
    void removeHomebrew(rule.id).then(() => status("Deleted."));
    render();
  },
  portrait: (rule) => portraits[rule.id],
  setPortrait: async (rule, file) => {
    try {
      portraits = await setPortrait(rule.id, await fileToDataUrl(file));
      render();
    } catch {
      status("Could not read that image — try a PNG or JPEG.");
    }
  },
  clearPortrait: async (rule) => {
    portraits = await removePortrait(rule.id);
    render();
  },
  rerender: () => render(),
};

/** Tabs live here rather than in the panel: this is the page you edit on. */
function renderTabs() {
  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: "party", label: "Party", count: party.length },
    { key: "homebrew", label: "Your entries", count: homebrew.length },
  ];
  return el("div", { class: "page-tabs" }, tabs.map((t) =>
    el("button", {
      class: `page-tab${tab === t.key ? " on" : ""}`, type: "button",
      onclick: () => { tab = t.key; render(); },
    }, [t.label, el("span", { class: "tab-count", text: String(t.count) })])
  ));
}

function renderToolbar() {
  if (tab === "party") {
    return el("div", { class: "toolbar-row" }, [
      el("button", {
        class: "btn-primary", type: "button", text: "Add character",
        onclick: () => {
          party = [...party, newCharacter()];
          void persist();
          render();
        },
      }),
    ]);
  }
  return el("div", { class: "toolbar-row" }, [
    el("span", { class: "fld-k", text: "Add" }),
    ...GROUP_CHOICES.map((choice) =>
      el("button", {
        class: "mini-btn", type: "button", text: choice.label,
        onclick: () => editorHost.add(choice.group),
      })
    ),
  ]);
}

function render() {
  listEl.textContent = "";
  listEl.append(renderTabs(), renderToolbar());

  if (tab === "homebrew") {
    listEl.append(renderHomebrew(editorHost));
    return;
  }

  if (!party.length) {
    listEl.append(el("div", { class: "empty-state" }, [
      el("p", { text: "No characters yet. Add one, or import a file someone sent you." }),
    ]));
    return;
  }
  listEl.append(el("div", { class: "stack" }, party.map(renderCharacter)));
}

document.getElementById("export")!.addEventListener("click", async () => {
  const blob = new Blob([await exportContent()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: "rules-overlay-content.json", saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status("Exported your characters, your entries and their pictures.");
});

const fileInput = document.getElementById("file") as HTMLInputElement;
document.getElementById("import")!.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const bundle = parseContentFile(await file.text());
    await importContent(bundle);
    [party, homebrew, portraits] = await Promise.all([getParty(), getHomebrew(), getPortraits()]);
    render();
    const parts = [
      bundle.characters.length ? `${bundle.characters.length} character${bundle.characters.length === 1 ? "" : "s"}` : "",
      bundle.homebrew.length ? `${bundle.homebrew.length} entr${bundle.homebrew.length === 1 ? "y" : "ies"}` : "",
    ].filter(Boolean);
    status(parts.length ? `Imported ${parts.join(" and ")}.` : "That file had nothing in it.");
  } catch (err) {
    status(`Could not import: ${(err as Error).message}`);
  }
  fileInput.value = "";
});

async function boot() {
  document.body.dataset.theme = resolveTheme((await getSettings()).appearance);
  [party, homebrew, { rules }, portraits] = await Promise.all([
    getParty(), getHomebrew(), loadDataset(), getPortraits(),
  ]);
  // The panel links here as #homebrew, or #homebrew:<id> to land on one
  // entry; otherwise open whichever side has something in it, so returning to
  // the page shows work rather than an empty tab.
  const [hash, wanted] = location.hash.replace(/^#/, "").split(":");
  if (hash === "homebrew" || (!party.length && homebrew.length)) tab = "homebrew";
  render();

  if (wanted) focusEntry(wanted);
}

/**
 * Brings one entry into view and puts the caret in its name. Without this a
 * link from the panel dropped you at the top of a long page of cards with no
 * clue which one you came for.
 */
function focusEntry(id: string) {
  const at = homebrew.findIndex((r) => r.id === id);
  if (at < 0) return;
  const card = listEl.querySelectorAll(".char")[at];
  if (!(card instanceof HTMLElement)) return;
  card.classList.add("just-linked");
  card.scrollIntoView({ block: "center" });
  (card.querySelector(".char-name") as HTMLInputElement | null)?.focus();
}

void boot();
