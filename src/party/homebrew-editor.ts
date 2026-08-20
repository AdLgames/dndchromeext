import { damageFromDesc, DAMAGE_TYPE_RE } from "../combat";
import {
  blankItemMeta, blankSpellMeta, blankStatBlock, describeHomebrew, newHomebrew,
} from "../homebrew";
import type { ActionEntry, NamedEntry, Rule, RuleGroup, StatBlock } from "../types";
import { el } from "../ui/dom";
import { emblem } from "../ui/emblem";

/** What the editor needs from the page it lives on. */
export type EditorHost = {
  entries: () => Rule[];
  patch: (id: string, changes: Partial<Rule>) => void;
  add: (group: RuleGroup) => void;
  remove: (rule: Rule) => void;
  portrait: (rule: Rule) => string | undefined;
  setPortrait: (rule: Rule, file: File) => void;
  clearPortrait: (rule: Rule) => void;
  rerender: () => void;
};

const GROUP_CHOICES: { group: RuleGroup; label: string }[] = [
  { group: "bestiary", label: "Monster" },
  { group: "spells", label: "Spell" },
  { group: "items", label: "Item" },
  { group: "rules", label: "Rule" },
  { group: "classes", label: "Feature" },
];

const CREATURE_TYPES = [
  "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend",
  "giant", "humanoid", "monstrosity", "ooze", "plant", "undead",
];

const SCHOOLS = [
  "abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion",
  "necromancy", "transmutation",
];

const RARITIES = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"];

const ITEM_KINDS = [
  "Wondrous item", "Weapon", "Armor", "Potion", "Ring", "Rod", "Scroll", "Staff", "Wand",
];

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

const ATTACK_LABELS = [
  "", "Melee Weapon Attack", "Ranged Weapon Attack", "Melee or Ranged Weapon Attack",
  "Melee Spell Attack", "Ranged Spell Attack", "Saving Throw", "Recharge 5-6",
];

// ---------------------------------------------------------------- fields ---

function field(label: string, control: HTMLElement, wide = false) {
  return el("label", { class: `fld${wide ? " wide" : ""}` }, [
    el("span", { class: "fld-k", text: label }),
    control,
  ]);
}

function text(value: string, onInput: (next: string) => void, placeholder = "") {
  return el("input", {
    type: "text", value, placeholder,
    oninput: (e: Event) => onInput((e.target as HTMLInputElement).value),
  });
}

function area(value: string, onInput: (next: string) => void, placeholder = "", rows = 4) {
  const node = el("textarea", {
    rows: String(rows), placeholder,
    oninput: (e: Event) => onInput((e.target as HTMLTextAreaElement).value),
  });
  node.value = value;
  return node;
}

function number(value: number, onInput: (next: number) => void) {
  return el("input", {
    type: "number", value: String(value),
    oninput: (e: Event) => onInput(parseInt((e.target as HTMLInputElement).value, 10) || 0),
  });
}

function select(value: string, options: string[], onChange: (next: string) => void, labels?: string[]) {
  const node = el("select", {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  }, options.map((option, i) =>
    el("option", { value: option, text: labels?.[i] ?? (option || "—") })
  ));
  node.value = value;
  return node;
}

function toggle(label: string, on: boolean, onChange: (next: boolean) => void) {
  return el("label", { class: `fld-check${on ? " on" : ""}` }, [
    el("input", {
      type: "checkbox", checked: on,
      onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
    }),
    label,
  ]);
}

// ------------------------------------------------------------- sub-forms ---

/**
 * Repeatable name + prose rows — a monster's traits, reactions and legendary
 * actions. Rebuilding on every keystroke would drop the caret, so rows are
 * only re-rendered when one is added or removed.
 */
function namedRows(
  title: string,
  rows: NamedEntry[],
  onChange: (next: NamedEntry[]) => void,
  rerender: () => void
) {
  const write = (i: number, changes: Partial<NamedEntry>) => {
    onChange(rows.map((row, j) => (i === j ? { ...row, ...changes } : row)));
  };

  return el("div", { class: "subrows" }, [
    el("span", { class: "fld-k", text: `${title} (${rows.length})` }),
    ...rows.map((row, i) =>
      el("div", { class: "sub-row" }, [
        text(row.name, (name) => write(i, { name }), "Name"),
        area(row.desc, (desc) => write(i, { desc }), "What it does", 2),
        el("button", {
          class: "mini-btn danger", text: "Remove", type: "button",
          onclick: () => { onChange(rows.filter((_, j) => j !== i)); rerender(); },
        }),
      ])
    ),
    el("button", {
      class: "mini-btn", text: `Add ${title.toLowerCase().replace(/s$/, "")}`, type: "button",
      onclick: () => { onChange([...rows, { name: "", desc: "" }]); rerender(); },
    }),
  ]);
}

/**
 * Attacks are the rows combat actually reads, so the editor shows what the
 * engine will parse out of each one: if the damage line goes unrecognised
 * the row says so rather than the attack silently vanishing from the
 * tracker.
 */
function actionRows(
  rows: ActionEntry[],
  onChange: (next: ActionEntry[]) => void,
  rerender: () => void
) {
  const write = (i: number, changes: Partial<ActionEntry>) => {
    onChange(rows.map((row, j) => (i === j ? { ...row, ...changes } : row)));
  };

  return el("div", { class: "subrows" }, [
    el("span", { class: "fld-k", text: `Actions (${rows.length})` }),
    ...rows.map((row, i) => {
      const damage = damageFromDesc(row.desc);
      const type = DAMAGE_TYPE_RE.exec(row.desc)?.[1]?.toLowerCase();
      return el("div", { class: "sub-row action-row" }, [
        text(row.name, (name) => write(i, { name }), "Name"),
        select(row.label ?? "", ATTACK_LABELS, (label) => write(i, { label: label || undefined })),
        text(row.value ?? "", (value) => write(i, { value: value || undefined }), "+4 or DC 13"),
        area(row.desc, (desc) => { write(i, { desc }); rerender(); },
          "Hit: 5 (1d6 + 2) slashing damage.", 2),
        el("span", { class: `parsed${damage ? "" : " none"}` , text: damage
          ? `Combat reads: ${damage}${type ? ` ${type}` : ""}`
          : "No damage found — combat will skip this one" }),
        el("button", {
          class: "mini-btn danger", text: "Remove", type: "button",
          onclick: () => { onChange(rows.filter((_, j) => j !== i)); rerender(); },
        }),
      ]);
    }),
    el("button", {
      class: "mini-btn", text: "Add action", type: "button",
      onclick: () => { onChange([...rows, { name: "", desc: "" }]); rerender(); },
    }),
  ]);
}

function statBlockForm(rule: Rule, host: EditorHost) {
  const stat = rule.monster ?? blankStatBlock();
  const write = (changes: Partial<StatBlock>) => host.patch(rule.id, { monster: { ...stat, ...changes } });
  const speed = stat.speeds[0]?.value ?? "30 ft";

  return el("div", { class: "form" }, [
    el("div", { class: "flds" }, [
      field("Type", select(rule.category, CREATURE_TYPES, (category) => host.patch(rule.id, { category }))),
      field("AC", number(stat.ac, (ac) => write({ ac }))),
      field("HP", number(stat.hp, (hp) => write({ hp }))),
      field("Hit dice", text(stat.hitDice ?? "", (hitDice) => write({ hitDice }), "2d8 + 2")),
      field("CR", text(stat.cr, (cr) => write({ cr }), "1/4")),
      field("XP", number(stat.xp, (xp) => write({ xp }))),
      field("Prof", number(stat.prof, (prof) => write({ prof }))),
      field("Speed", text(speed, (value) => write({ speeds: [{ label: "walk", value }] }), "30 ft")),
    ]),
    el("div", { class: "flds" }, ABILITY_KEYS.map((key) =>
      field(key.toUpperCase(), number(stat.abilities[key], (value) =>
        write({ abilities: { ...stat.abilities, [key]: value } })))
    )),
    el("div", { class: "flds" }, [
      field("Saves", text(stat.saves ?? "", (saves) => write({ saves }), "Dex +5, Con +7"), true),
      field("Skills", text(stat.skills ?? "", (skills) => write({ skills }), "Stealth +6"), true),
      field("Senses", text(stat.senses ?? "", (senses) => write({ senses }), "darkvision 60 ft"), true),
      field("Languages", text(stat.languages ?? "", (languages) => write({ languages }), "Common"), true),
      field("Resistances", text(stat.resistances ?? "", (resistances) => write({ resistances })), true),
      field("Immunities", text(stat.immunities ?? "", (immunities) => write({ immunities })), true),
      field("Condition immunities",
        text(stat.conditionImmunities ?? "", (conditionImmunities) => write({ conditionImmunities })), true),
      field("Vulnerabilities",
        text(stat.vulnerabilities ?? "", (vulnerabilities) => write({ vulnerabilities })), true),
    ]),
    actionRows(stat.actions, (actions) => write({ actions }), host.rerender),
    namedRows("Traits", stat.traits, (traits) => write({ traits }), host.rerender),
    namedRows("Reactions", stat.reactions, (reactions) => write({ reactions }), host.rerender),
    namedRows("Legendary actions", stat.legendary, (legendary) => write({ legendary }), host.rerender),
  ]);
}

function spellForm(rule: Rule, host: EditorHost) {
  const spell = rule.spell ?? blankSpellMeta();
  const write = (changes: Partial<typeof spell>) => host.patch(rule.id, { spell: { ...spell, ...changes } });

  return el("div", { class: "form" }, [
    el("div", { class: "flds" }, [
      field("Level", select(String(spell.level), ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
        (level) => write({ level: Number(level) }),
        ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"])),
      field("School", select(spell.school, SCHOOLS, (school) => {
        write({ school });
        host.patch(rule.id, { category: school });
      })),
      field("Casting time", text(spell.castingTime, (castingTime) => write({ castingTime }))),
      field("Range", text(spell.range, (range) => write({ range }))),
      field("Components", text(spell.components, (components) => write({ components }), "V, S, M")),
      field("Duration", text(spell.duration, (duration) => write({ duration }))),
      field("Classes", text(spell.classes.join(", "),
        (value) => write({ classes: value.split(",").map((s) => s.trim()).filter(Boolean) }),
        "Wizard, Sorcerer"), true),
    ]),
    el("div", { class: "flds checks" }, [
      toggle("Concentration", spell.concentration, (concentration) => write({ concentration })),
      toggle("Ritual", spell.ritual, (ritual) => write({ ritual })),
    ]),
    field("At higher levels",
      area(spell.higherLevel ?? "", (higherLevel) => write({ higherLevel }),
        "When you cast this spell using a slot of 4th level or higher…", 2), true),
  ]);
}

function itemForm(rule: Rule, host: EditorHost) {
  const item = rule.item ?? blankItemMeta();
  const write = (changes: Partial<typeof item>) => host.patch(rule.id, { item: { ...item, ...changes } });

  return el("div", { class: "form" }, [
    el("div", { class: "flds" }, [
      field("Kind", select(item.kind, ITEM_KINDS, (kind) => write({ kind }))),
      field("Rarity", select(item.rarity, RARITIES, (rarity) => write({ rarity }))),
    ]),
    el("div", { class: "flds checks" }, [
      toggle("Requires attunement", item.attunement, (attunement) => write({ attunement })),
    ]),
  ]);
}

// ------------------------------------------------------------------ card ---

function picture(rule: Rule, host: EditorHost) {
  const current = host.portrait(rule);
  const file = el("input", { type: "file", accept: "image/*", style: "display:none" });
  file.addEventListener("change", () => {
    const picked = file.files?.[0];
    file.value = "";
    if (picked) host.setPortrait(rule, picked);
  });

  return el("div", { class: "portrait-wrap" }, [
    el("button", {
      class: "portrait-slot", type: "button",
      title: current ? "Change picture" : "Add a picture",
      onclick: () => file.click(),
    }, [emblem(describeHomebrew(rule), { size: 52, portrait: current })]),
    file,
    current
      ? el("button", {
          class: "portrait-clear", type: "button", title: "Remove picture", text: "×",
          onclick: () => host.clearPortrait(rule),
        })
      : null,
  ]);
}

function card(rule: Rule, host: EditorHost) {
  const head = el("div", { class: "char-head" }, [
    picture(rule, host),
    el("input", {
      class: "char-name", type: "text", value: rule.title, placeholder: "Name",
      "aria-label": "entry name",
      oninput: (e: Event) => host.patch(rule.id, { title: (e.target as HTMLInputElement).value }),
    }),
    select(rule.group, GROUP_CHOICES.map((c) => c.group), (group) => {
      // Switching kind swaps the sub-block, so the detail view and this form
      // stay in step; anything typed into the old kind's fields is dropped.
      const next = newHomebrew(group as RuleGroup);
      host.patch(rule.id, {
        group: group as RuleGroup,
        category: next.category,
        monster: next.monster,
        spell: next.spell,
        item: next.item,
      });
      host.rerender();
    }, GROUP_CHOICES.map((c) => c.label)),
    el("button", {
      class: "mini-btn danger", text: "Delete", type: "button",
      style: "margin-left:auto",
      onclick: () => host.remove(rule),
    }),
  ]);

  const body = el("div", { class: "form" }, [
    field("Description",
      area(rule.body, (value) => host.patch(rule.id, { body: value }),
        "What it does. Dice like 2d6 + 3 become buttons you can roll.", 5), true),
    el("div", { class: "flds" }, [
      field("Summary (Explain simply)",
        text(rule.tldr ?? "", (tldr) => host.patch(rule.id, { tldr }), "One plain sentence"), true),
      field("Search keywords",
        text((rule.keywords ?? []).join(", "),
          (value) => host.patch(rule.id, {
            keywords: value.split(",").map((s) => s.trim()).filter(Boolean),
          }),
          "Other words you might search for"), true),
    ]),
  ]);

  const specific =
    rule.group === "bestiary" ? statBlockForm(rule, host)
    : rule.group === "spells" ? spellForm(rule, host)
    : rule.group === "items" ? itemForm(rule, host)
    : null;

  return el("div", { class: "char" }, [head, specific, body]);
}

export function renderHomebrew(host: EditorHost): HTMLElement {
  const entries = host.entries();
  const wrap = el("div", { class: "stack" });

  if (!entries.length) {
    wrap.append(el("div", { class: "empty-state" }, [
      el("p", { text: "Nothing of your own yet. Add a monster, spell or item and it joins the search, the catalogue and the combat tracker alongside the published ones." }),
    ]));
    return wrap;
  }

  wrap.append(...entries.map((rule) => card(rule, host)));
  return wrap;
}

export { GROUP_CHOICES };
