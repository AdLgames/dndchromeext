/** Top-level browse/filter buckets shown in the panel. */
export type RuleGroup = "bestiary" | "spells" | "rules" | "items" | "classes";

export const RULE_GROUPS: RuleGroup[] = ["bestiary", "spells", "rules", "items", "classes"];

export const GROUP_LABELS: Record<RuleGroup, string> = {
  bestiary: "Bestiary",
  spells: "Spells",
  rules: "Rules",
  items: "Items",
  classes: "Classes & features",
};

export type AbilityScores = {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
};

export type NamedEntry = { name: string; desc: string };

/** An action/attack line, with the attack bonus or save DC pulled out. */
export type ActionEntry = NamedEntry & {
  label?: string; // "Melee weapon attack", "Recharge 5-6"
  value?: string; // "+4", "DC 11"
};

export type StatBlock = {
  ac: number;
  acNote?: string;
  hp: number;
  hitDice?: string;
  cr: string; // "1/4", "2", "21"
  xp: number;
  prof: number;
  speeds: { label: string; value: string }[];
  abilities: AbilityScores;
  saves?: string;
  skills?: string;
  vulnerabilities?: string;
  resistances?: string;
  immunities?: string;
  conditionImmunities?: string;
  senses?: string;
  languages?: string;
  traits: NamedEntry[];
  actions: ActionEntry[];
  reactions: NamedEntry[];
  legendary: NamedEntry[];
};

export type SpellMeta = {
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  material?: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  classes: string[];
  higherLevel?: string;
};

export type ItemMeta = {
  kind: string; // "Wondrous item", "Potion", "Weapon"…
  rarity: string;
  attunement: boolean;
};

export type FeatureMeta = {
  className: string;
  level?: number;
  subclass?: string;
};

export type Rule = {
  id: string; // slug, stable — aliases reference this
  title: string;
  group: RuleGroup;
  category: string; // fine-grained label: "combat", "evocation", "dragon"…
  body: string;
  subtitle?: string; // "Medium dragon · chaotic evil"
  badge?: string; // right-aligned result badge: "CR 2", "Lvl 3"
  seeAlso?: string[];
  monster?: StatBlock;
  spell?: SpellMeta;
  item?: ItemMeta;
  feature?: FeatureMeta;
};

export type AliasTable = Record<string, string>; // alias text -> rule id

export const TOGGLE_MESSAGE = "rules-overlay:toggle" as const;
export const LOOKUP_MESSAGE = "rules-overlay:lookup" as const;
export const GET_SELECTION_MESSAGE = "rules-overlay:get-selection" as const;

export type RuntimeMessage =
  | { type: typeof TOGGLE_MESSAGE }
  | { type: typeof LOOKUP_MESSAGE; query: string }
  | { type: typeof GET_SELECTION_MESSAGE };
