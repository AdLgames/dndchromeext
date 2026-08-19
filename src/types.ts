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

/** A one-tap thing to do from a rule: roll it, or jump somewhere useful. */
export type QuickAction =
  | { kind: "roll"; label: string; expr: string }
  | { kind: "check"; label: string; ability: string }
  | { kind: "perUnit"; label: string; expr: string; unit: string; unitSize: number }
  | { kind: "rule"; label: string; ruleId: string }
  | { kind: "flow"; label: string; flowId: string }
  | { kind: "note"; label: string; text: string };

export type Rule = {
  id: string; // slug, stable — aliases reference this
  title: string;
  group: RuleGroup;
  category: string; // fine-grained label: "combat", "evocation", "dragon"…
  body: string;
  subtitle?: string; // "Medium dragon · chaotic evil"
  badge?: string; // right-aligned result badge: "CR 2", "Lvl 3"
  seeAlso?: string[];
  /** Plain-English summary, hand-authored — powers "Explain simply". */
  tldr?: string;
  example?: string;
  /** Extra search terms so natural-language questions land here. */
  keywords?: string[];
  actions?: QuickAction[];
  monster?: StatBlock;
  spell?: SpellMeta;
  item?: ItemMeta;
  feature?: FeatureMeta;
};

/** A stepped answer to "what happens if…" — the rules graph, walked. */
export type FlowStep = {
  title: string;
  detail?: string;
  ruleId?: string;
  roll?: { label: string; expr: string };
  perUnit?: { label: string; expr: string; unit: string; unitSize: number };
  applies?: string[]; // condition rule ids this step imposes
};

export type Flow = {
  id: string;
  title: string;
  prompt: string; // "I fall off my horse"
  triggers: string[];
  steps: FlowStep[];
};

// ------------------------------------------------------------- party ----
export type CharacterEntry = {
  /** Set when the entry came from the SRD dictionary; absent for free text. */
  ruleId?: string;
  name: string;
  note?: string;
};

export type Character = {
  id: string;
  name: string;
  className: string;
  level: number;
  ac: number;
  hp: number;
  maxHp: number;
  speed: number;
  abilities: AbilityScores;
  spells: CharacterEntry[];
  actions: CharacterEntry[];
  items: CharacterEntry[];
  notes: string;
};

// ------------------------------------------------------------ combat ----
export type Combatant = {
  id: string;
  name: string;
  initiative: number;
  ac: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  speed: number;
  movementUsed: number;
  conditions: string[]; // condition rule ids
  concentrating: boolean;
  concentrationNote: string;
  reactionUsed: boolean;
  deathSaves: { successes: number; failures: number };
  isPlayer: boolean;
  ruleId?: string; // linked bestiary entry
  characterId?: string; // linked party member
};

export type Encounter = {
  round: number;
  turn: number;
  combatants: Combatant[];
};

export type AliasTable = Record<string, string>; // alias text -> rule id

export const TOGGLE_MESSAGE = "rules-overlay:toggle" as const;
export const LOOKUP_MESSAGE = "rules-overlay:lookup" as const;
export const GET_SELECTION_MESSAGE = "rules-overlay:get-selection" as const;

export type RuntimeMessage =
  | { type: typeof TOGGLE_MESSAGE }
  | { type: typeof LOOKUP_MESSAGE; query: string }
  | { type: typeof GET_SELECTION_MESSAGE };
