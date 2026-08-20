import type {
  AbilityScores, ActionEntry, ItemMeta, NamedEntry, Rule, RuleGroup, SourceRecord, SpellMeta,
  StatBlock,
} from "./types";
import { RULE_GROUPS } from "./types";

const HOMEBREW_KEY = "rulesOverlay:homebrew";

/** Homebrew ids carry this prefix so they can never shadow a bundled slug. */
const ID_PREFIX = "hb-";

const MAX_ENTRIES = 500;
const MAX_TEXT = 8000;
const MAX_LINE = 300;
const MAX_LIST = 60;

/**
 * Your own entries are a content pack like any other: they get a source
 * record, so the footer can name them, results can tag them, and settings
 * can switch them off without deleting anything.
 */
export const HOMEBREW_SOURCE_ID = "homebrew";

export const HOMEBREW_SOURCE: SourceRecord = {
  id: HOMEBREW_SOURCE_ID,
  name: "Your homebrew",
  license: "Yours",
  attribution: "Your own entries, stored on this device. Not part of any published SRD.",
};

export function newHomebrewId(): string {
  return `${ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const BLANK_ABILITIES: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export function blankStatBlock(): StatBlock {
  return {
    ac: 12, hp: 11, hitDice: "2d8 + 2", cr: "1/4", xp: 50, prof: 2,
    speeds: [{ label: "walk", value: "30 ft" }],
    abilities: { ...BLANK_ABILITIES },
    traits: [], actions: [], reactions: [], legendary: [],
  };
}

export function blankSpellMeta(): SpellMeta {
  return {
    level: 1, school: "evocation", castingTime: "1 action", range: "60 feet",
    components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [],
  };
}

export function blankItemMeta(): ItemMeta {
  return { kind: "Wondrous item", rarity: "uncommon", attunement: false };
}

/** A new, empty entry of the given kind, ready for the editor. */
export function newHomebrew(group: RuleGroup): Rule {
  const rule: Rule = {
    id: newHomebrewId(),
    title: "",
    group,
    source: HOMEBREW_SOURCE_ID,
    category: group === "bestiary" ? "humanoid" : group === "spells" ? "evocation" : "homebrew",
    body: "",
  };
  if (group === "bestiary") rule.monster = blankStatBlock();
  if (group === "spells") rule.spell = blankSpellMeta();
  if (group === "items") rule.item = blankItemMeta();
  return rule;
}

export async function getHomebrew(): Promise<Rule[]> {
  const stored = await chrome.storage.local.get(HOMEBREW_KEY);
  const saved = stored[HOMEBREW_KEY] as unknown;
  // Anything already in storage went through sanitizeRule on the way in, but
  // re-coercing on read costs nothing and keeps a hand-edited profile honest.
  return Array.isArray(saved) ? saved.map(sanitizeRule) : [];
}

export async function saveHomebrew(entries: Rule[]): Promise<Rule[]> {
  const next = entries.slice(0, MAX_ENTRIES).map(sanitizeRule);
  await chrome.storage.local.set({ [HOMEBREW_KEY]: next });
  return next;
}

export async function upsertHomebrew(rule: Rule): Promise<Rule[]> {
  const entries = await getHomebrew();
  const at = entries.findIndex((e) => e.id === rule.id);
  if (at >= 0) entries[at] = rule;
  else entries.push(rule);
  return saveHomebrew(entries);
}

export async function removeHomebrew(id: string): Promise<Rule[]> {
  return saveHomebrew((await getHomebrew()).filter((e) => e.id !== id));
}

export function onHomebrewChanged(fn: (entries: Rule[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[HOMEBREW_KEY]) {
      const next = changes[HOMEBREW_KEY].newValue;
      fn(Array.isArray(next) ? next.map(sanitizeRule) : []);
    }
  });
}

// ------------------------------------------------------------ coercion ---
// Import is where untrusted JSON enters. Nothing below trusts a field: every
// value is coerced to the shape the rest of the app already assumes, so a
// malformed or hostile file yields a dull entry rather than odd shapes
// surfacing deep in the panel.

const str = (value: unknown, fallback = "", max = MAX_LINE) =>
  typeof value === "string" ? value.slice(0, max) : fallback;

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const bool = (value: unknown) => value === true;

const optional = (value: unknown, max = MAX_LINE) => {
  const text = str(value, "", max);
  return text ? text : undefined;
};

const strings = (value: unknown) =>
  Array.isArray(value) ? value.slice(0, MAX_LIST).map((v) => str(v)).filter(Boolean) : [];

const named = (value: unknown): NamedEntry[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_LIST).map((e) => ({
        name: str((e as NamedEntry)?.name, "Unnamed"),
        desc: str((e as NamedEntry)?.desc, "", MAX_TEXT),
      }))
    : [];

const actionEntries = (value: unknown): ActionEntry[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_LIST).map((e) => ({
        name: str((e as ActionEntry)?.name, "Unnamed"),
        desc: str((e as ActionEntry)?.desc, "", MAX_TEXT),
        label: optional((e as ActionEntry)?.label),
        value: optional((e as ActionEntry)?.value),
      }))
    : [];

const abilities = (value: unknown): AbilityScores => {
  const raw = (value ?? {}) as Partial<AbilityScores>;
  return {
    str: num(raw.str, 10), dex: num(raw.dex, 10), con: num(raw.con, 10),
    int: num(raw.int, 10), wis: num(raw.wis, 10), cha: num(raw.cha, 10),
  };
};

function statBlock(value: unknown): StatBlock {
  const raw = (value ?? {}) as Partial<StatBlock>;
  const base = blankStatBlock();
  return {
    ac: num(raw.ac, base.ac),
    acNote: optional(raw.acNote),
    hp: num(raw.hp, base.hp),
    hitDice: optional(raw.hitDice),
    cr: str(raw.cr, base.cr, 12),
    xp: num(raw.xp, base.xp),
    prof: num(raw.prof, base.prof),
    speeds: Array.isArray(raw.speeds)
      ? raw.speeds.slice(0, 8).map((s) => ({ label: str(s?.label, "walk", 24), value: str(s?.value, "30 ft", 24) }))
      : base.speeds,
    abilities: abilities(raw.abilities),
    saves: optional(raw.saves),
    skills: optional(raw.skills),
    vulnerabilities: optional(raw.vulnerabilities),
    resistances: optional(raw.resistances),
    immunities: optional(raw.immunities),
    conditionImmunities: optional(raw.conditionImmunities),
    senses: optional(raw.senses),
    languages: optional(raw.languages),
    traits: named(raw.traits),
    actions: actionEntries(raw.actions),
    reactions: named(raw.reactions),
    legendary: named(raw.legendary),
  };
}

function spellMeta(value: unknown): SpellMeta {
  const raw = (value ?? {}) as Partial<SpellMeta>;
  const base = blankSpellMeta();
  return {
    level: Math.max(0, Math.min(9, Math.round(num(raw.level, base.level)))),
    school: str(raw.school, base.school, 24).toLowerCase(),
    castingTime: str(raw.castingTime, base.castingTime),
    range: str(raw.range, base.range),
    components: str(raw.components, base.components),
    material: optional(raw.material, MAX_TEXT),
    duration: str(raw.duration, base.duration),
    concentration: bool(raw.concentration),
    ritual: bool(raw.ritual),
    classes: strings(raw.classes),
    higherLevel: optional(raw.higherLevel, MAX_TEXT),
  };
}

function itemMeta(value: unknown): ItemMeta {
  const raw = (value ?? {}) as Partial<ItemMeta>;
  const base = blankItemMeta();
  return {
    kind: str(raw.kind, base.kind, 48),
    rarity: str(raw.rarity, base.rarity, 48),
    attunement: bool(raw.attunement),
  };
}

/** Coerces anything into a homebrew Rule. Never throws. */
export function sanitizeRule(raw: unknown): Rule {
  const input = (raw ?? {}) as Partial<Rule>;
  const group: RuleGroup = RULE_GROUPS.includes(input.group as RuleGroup)
    ? (input.group as RuleGroup)
    : "rules";

  // Ids survive import so a shared entry keeps its picture and any pin
  // pointing at it, but they are forced into the homebrew namespace.
  const rawId = str(input.id, "", 64);
  const id = rawId.startsWith(ID_PREFIX) ? rawId : newHomebrewId();

  const rule: Rule = {
    id,
    title: str(input.title, "Untitled"),
    group,
    source: HOMEBREW_SOURCE_ID,
    category: str(input.category, "homebrew", 48),
    body: str(input.body, "", MAX_TEXT),
    subtitle: optional(input.subtitle),
    badge: optional(input.badge, 24),
    tldr: optional(input.tldr, MAX_TEXT),
    example: optional(input.example, MAX_TEXT),
    keywords: strings(input.keywords),
  };

  // Only the sub-block matching the group is kept — a "spell" carrying a
  // stat block would render two different detail layouts at once.
  if (group === "bestiary") rule.monster = statBlock(input.monster);
  if (group === "spells") rule.spell = spellMeta(input.spell);
  if (group === "items") rule.item = itemMeta(input.item);

  return rule;
}

/** The subtitle/badge the panel shows, kept in step with what was typed. */
export function describeHomebrew(rule: Rule): Rule {
  const next = { ...rule };
  if (rule.monster) {
    next.subtitle = rule.subtitle || `${rule.category}`.trim();
    next.badge = `CR ${rule.monster.cr}`;
  } else if (rule.spell) {
    const level = rule.spell.level === 0 ? "Cantrip" : `Level ${rule.spell.level}`;
    next.subtitle = rule.subtitle || `${level} ${rule.spell.school}`.trim();
    next.badge = rule.spell.level === 0 ? "Cantrip" : `Lvl ${rule.spell.level}`;
  } else if (rule.item) {
    next.subtitle = rule.subtitle || `${rule.item.kind}, ${rule.item.rarity}`;
    next.badge = "Homebrew";
  } else {
    next.badge = "Homebrew";
  }
  return next;
}
