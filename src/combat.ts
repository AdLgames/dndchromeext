import type { Character, Combatant, Encounter, Rule } from "./types";

const ENCOUNTER_KEY = "rulesOverlay:encounter";

export const EMPTY_ENCOUNTER: Encounter = { round: 1, turn: 0, combatants: [] };

function id(): string {
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blank(name: string): Combatant {
  return {
    id: id(), name, initiative: 0, ac: 10, hp: 10, maxHp: 10, tempHp: 0,
    speed: 30, movementUsed: 0, conditions: [], concentrating: false,
    concentrationNote: "", reactionUsed: false,
    deathSaves: { successes: 0, failures: 0 }, isPlayer: false,
  };
}

export function combatantFromMonster(rule: Rule, suffix?: string): Combatant {
  const m = rule.monster;
  const base = blank(suffix ? `${rule.title} ${suffix}` : rule.title);
  if (!m) return { ...base, ruleId: rule.id };
  const walk = m.speeds.find((s) => s.label === "walk")?.value ?? "30 ft";
  return {
    ...base,
    ac: m.ac,
    hp: m.hp,
    maxHp: m.hp,
    speed: parseInt(walk, 10) || 30,
    ruleId: rule.id,
  };
}

export function combatantFromCharacter(character: Character): Combatant {
  return {
    ...blank(character.name),
    ac: character.ac,
    hp: character.hp,
    maxHp: character.maxHp,
    speed: character.speed,
    isPlayer: true,
    characterId: character.id,
  };
}

export function combatantBlank(name: string): Combatant {
  return blank(name);
}

/** Initiative order: highest first, ties broken stably by name. */
export function ordered(encounter: Encounter): Combatant[] {
  return [...encounter.combatants].sort(
    (a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name)
  );
}

/**
 * Advances the turn. Movement and reaction reset at the start of a
 * combatant's own turn, which is when 5e refreshes them.
 */
export function advance(encounter: Encounter, direction: 1 | -1 = 1): Encounter {
  const list = ordered(encounter);
  if (!list.length) return encounter;

  let turn = encounter.turn + direction;
  let round = encounter.round;
  if (turn >= list.length) { turn = 0; round += 1; }
  if (turn < 0) { turn = list.length - 1; round = Math.max(1, round - 1); }

  const active = list[turn];
  const combatants = encounter.combatants.map((c) =>
    c.id === active.id ? { ...c, movementUsed: 0, reactionUsed: false } : c
  );
  return { round, turn, combatants };
}

export async function getEncounter(): Promise<Encounter> {
  const stored = await chrome.storage.local.get(ENCOUNTER_KEY);
  return (stored[ENCOUNTER_KEY] as Encounter | undefined) ?? EMPTY_ENCOUNTER;
}

export async function saveEncounter(encounter: Encounter): Promise<void> {
  await chrome.storage.local.set({ [ENCOUNTER_KEY]: encounter });
}

export function onEncounterChanged(fn: (encounter: Encounter) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ENCOUNTER_KEY]) fn(changes[ENCOUNTER_KEY].newValue ?? EMPTY_ENCOUNTER);
  });
}

/** Conditions offered in the tracker, as rule ids in the bundled data. */
export const TRACKED_CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
  "stunned", "unconscious", "exhaustion",
];
