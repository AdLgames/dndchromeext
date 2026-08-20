import { loadDataset } from "../data/load";
import { exportParty, getParty, newCharacter, parsePartyFile, saveParty } from "../party";
import { getSettings, resolveTheme } from "../settings";
import type { AbilityScores, Character, CharacterEntry, Rule, RuleGroup } from "../types";
import { el } from "../ui/dom";
import { emblemFor } from "../ui/emblem";
import {
  characterPortraitKey, fileToDataUrl, getPortraits, removePortrait, setPortrait,
  type Portraits,
} from "../portraits";

const ABILITY_KEYS: (keyof AbilityScores)[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Which SRD group each list picks from; free text is always allowed too. */
const LISTS: { key: "spells" | "actions" | "items"; label: string; group: RuleGroup | null }[] = [
  { key: "spells", label: "Spells", group: "spells" },
  { key: "actions", label: "Actions & features", group: "classes" },
  { key: "items", label: "Items & equipment", group: "items" },
];

let party: Character[] = [];
let rules: Rule[] = [];
let portraits: Portraits = {};
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

    const pool = list.group ? rules.filter((r) => r.group === list.group) : rules;
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
    el("input", {
      class: "text-input", type: "text", value: character.className, placeholder: "Class",
      "aria-label": "class",
      oninput: (e: Event) => patch(character.id, { className: (e.target as HTMLInputElement).value }),
    }),
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

function render() {
  listEl.textContent = "";
  if (!party.length) {
    listEl.append(el("div", { class: "empty-state" }, [
      el("p", { text: "No characters yet. Add one, or import a party file someone sent you." }),
    ]));
    return;
  }
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:24px" },
    party.map(renderCharacter));
  listEl.append(wrap);
}

document.getElementById("add")!.addEventListener("click", () => {
  party = [...party, newCharacter()];
  void persist();
  render();
});

document.getElementById("export")!.addEventListener("click", async () => {
  const blob = new Blob([exportParty(party)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: "rules-overlay-party.json", saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status("Party exported.");
});

const fileInput = document.getElementById("file") as HTMLInputElement;
document.getElementById("import")!.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const imported = parsePartyFile(await file.text());
    party = [...party, ...imported];
    await persist();
    render();
    status(`Imported ${imported.length} character${imported.length === 1 ? "" : "s"}.`);
  } catch (err) {
    status(`Could not import: ${(err as Error).message}`);
  }
  fileInput.value = "";
});

async function boot() {
  document.body.dataset.theme = resolveTheme((await getSettings()).appearance);
  [party, { rules }, portraits] = await Promise.all([getParty(), loadDataset(), getPortraits()]);
  render();
}

void boot();
