import type { AbilityScores, Character } from "./types";

const PARTY_KEY = "rulesOverlay:party";

export const BLANK_ABILITIES: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export function newCharacter(name = "New character"): Character {
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    className: "",
    level: 1,
    ac: 10,
    hp: 10,
    maxHp: 10,
    speed: 30,
    abilities: { ...BLANK_ABILITIES },
    spells: [],
    actions: [],
    items: [],
    notes: "",
  };
}

export async function getParty(): Promise<Character[]> {
  const stored = await chrome.storage.local.get(PARTY_KEY);
  return (stored[PARTY_KEY] as Character[] | undefined) ?? [];
}

export async function saveParty(party: Character[]): Promise<void> {
  await chrome.storage.local.set({ [PARTY_KEY]: party });
}

export function onPartyChanged(fn: (party: Character[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PARTY_KEY]) fn(changes[PARTY_KEY].newValue ?? []);
  });
}

export type PartyFile = { format: "rules-overlay-party"; version: 1; characters: Character[] };

export function exportParty(party: Character[]): string {
  return JSON.stringify({ format: "rules-overlay-party", version: 1, characters: party } satisfies PartyFile, null, 2);
}

/**
 * Reads a party file. Import is the one place untrusted JSON enters, so
 * every field is coerced rather than trusted — a malformed or hostile file
 * yields a well-formed character, never arbitrary shapes downstream.
 */
export function parsePartyFile(text: string): Character[] {
  const data = JSON.parse(text) as Partial<PartyFile>;
  if (!data || data.format !== "rules-overlay-party" || !Array.isArray(data.characters)) {
    throw new Error("Not a Rules Overlay party file.");
  }

  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
  const entries = (value: unknown) =>
    Array.isArray(value)
      ? value.slice(0, 200).map((e) => ({
          ruleId: typeof e?.ruleId === "string" ? e.ruleId : undefined,
          name: str(e?.name, "Unnamed"),
          note: typeof e?.note === "string" ? e.note : undefined,
        }))
      : [];

  return data.characters.slice(0, 20).map((c) => {
    const base = newCharacter(str(c?.name, "Unnamed"));
    const abilities = (c?.abilities ?? {}) as Partial<AbilityScores>;
    return {
      ...base,
      className: str(c?.className),
      level: num(c?.level, 1),
      ac: num(c?.ac, 10),
      hp: num(c?.hp, 10),
      maxHp: num(c?.maxHp, 10),
      speed: num(c?.speed, 30),
      abilities: {
        str: num(abilities.str, 10), dex: num(abilities.dex, 10), con: num(abilities.con, 10),
        int: num(abilities.int, 10), wis: num(abilities.wis, 10), cha: num(abilities.cha, 10),
      },
      spells: entries(c?.spells),
      actions: entries(c?.actions),
      items: entries(c?.items),
      notes: str(c?.notes),
    };
  });
}
