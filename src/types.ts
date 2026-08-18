export type Rule = {
  id: string; // slug, stable — aliases reference this
  title: string;
  category: string; // "combat" | "conditions" | "spellcasting" | ...
  body: string; // markdown, kept short — this is a lookup, not a reader
  seeAlso?: string[]; // rule ids
};

export type AliasTable = Record<string, string>; // alias text -> rule id

export const TOGGLE_MESSAGE = "rules-overlay:toggle" as const;

export type RuntimeMessage = { type: typeof TOGGLE_MESSAGE };
