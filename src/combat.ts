import { roll, type RollDetail } from "./dice";
import type {
  AbilityScores, Attack, Character, Combatant, CombatEvent, Encounter, Rule, StatBlock,
} from "./types";

const ENCOUNTER_KEY = "rulesOverlay:encounter";
const LOG_MAX = 40;

export const EMPTY_ENCOUNTER: Encounter = { round: 1, turn: 0, combatants: [], log: [] };

const DEFAULT_ABILITIES: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function id(): string {
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blank(name: string): Combatant {
  return {
    id: id(), name, initiative: 0, ac: 10, hp: 10, maxHp: 10, tempHp: 0,
    speed: 30, movementUsed: 0, conditions: [], concentrating: false,
    concentrationNote: "", reactionUsed: false,
    deathSaves: { successes: 0, failures: 0 }, isPlayer: false,
    attacks: [], abilities: { ...DEFAULT_ABILITIES }, saveBonuses: {},
  };
}

/** Pulls "Hit: 7 (1d10 + 2)" out of an action's prose so it can be rolled. */
export function damageFromDesc(desc: string): string | undefined {
  const hit = /Hit:\s*\d+\s*\(([^)]+)\)/i.exec(desc);
  if (hit) return hit[1].trim();
  const bare = /\b(\d{0,3}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)\b/.exec(desc);
  return bare?.[1];
}

export function attacksFromStatBlock(stat: StatBlock): Attack[] {
  const attacks: Attack[] = [];
  for (const action of stat.actions) {
    const damage = damageFromDesc(action.desc);
    if (!damage) continue;
    const note = action.value?.startsWith("DC") ? action.value : action.label;
    attacks.push({
      name: action.name,
      bonus: action.value?.startsWith("+") ? parseInt(action.value, 10) : 0,
      damage,
      ...(note ? { note } : {}),
    });
  }
  return attacks;
}

export function combatantFromMonster(rule: Rule, suffix?: string): Combatant {
  const m = rule.monster;
  const base = blank(suffix ? `${rule.title} ${suffix}` : rule.title);
  if (!m) return { ...base, ruleId: rule.id };

  const walk = m.speeds.find((s) => s.label === "walk")?.value ?? "30 ft";
  const saveBonuses: Combatant["saveBonuses"] = {};
  for (const part of (m.saves ?? "").split(",")) {
    const match = /(STR|DEX|CON|INT|WIS|CHA)\s*([+-]\d+)/i.exec(part);
    if (match) saveBonuses[match[1].toLowerCase() as keyof AbilityScores] = parseInt(match[2], 10);
  }

  return {
    ...base,
    ac: m.ac,
    hp: m.hp,
    maxHp: m.hp,
    speed: parseInt(walk, 10) || 30,
    ruleId: rule.id,
    abilities: m.abilities,
    attacks: attacksFromStatBlock(m),
    saveBonuses,
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
    abilities: character.abilities,
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
  return { ...encounter, round, turn, combatants };
}

export function logEvent(encounter: Encounter, event: Omit<CombatEvent, "at">): Encounter {
  return { ...encounter, log: [{ ...event, at: Date.now() }, ...encounter.log].slice(0, LOG_MAX) };
}

/**
 * Applies damage through temporary hit points first, and never drops below
 * 0 — a creature at 0 is dying, not negative.
 */
export function applyDamage(c: Combatant, amount: number): Combatant {
  const absorbed = Math.min(c.tempHp, amount);
  const hp = Math.max(0, c.hp - (amount - absorbed));
  return { ...c, tempHp: c.tempHp - absorbed, hp };
}

export function applyHealing(c: Combatant, amount: number): Combatant {
  const hp = Math.min(c.maxHp, c.hp + amount);
  return {
    ...c,
    hp,
    deathSaves: hp > 0 ? { successes: 0, failures: 0 } : c.deathSaves,
  };
}

export type AttackResult = {
  attackRoll: RollDetail;
  total: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  damage?: RollDetail;
  damageTotal: number;
  concentration?: { dc: number; save: RollDetail; held: boolean };
};

/**
 * Resolves one attack end to end: d20 + bonus against the target's AC,
 * criticals doubling the damage dice, and — if the target was holding a
 * spell — the Constitution save that damage forces.
 */
export function resolveAttack(
  attacker: Combatant,
  attack: Attack,
  target: Combatant,
  mode: "normal" | "adv" | "dis" = "normal"
): AttackResult {
  const attackRoll = roll(`1d20 ${attack.bonus >= 0 ? "+" : "-"} ${Math.abs(attack.bonus)}`, {
    label: `${attacker.name}: ${attack.name}`,
    mode,
  });

  const natural = attackRoll.dice[0]?.values[0] ?? 0;
  const crit = natural === 20;
  const fumble = natural === 1;
  const hit = crit || (!fumble && attackRoll.total >= target.ac);

  const result: AttackResult = {
    attackRoll, total: attackRoll.total, hit, crit, fumble, damageTotal: 0,
  };
  if (!hit) return result;

  // A critical doubles the dice, not the modifier.
  const expr = crit
    ? attack.damage.replace(/\b(\d{0,3})d(\d{1,3})\b/i, (_m, n: string, sides: string) =>
        `${(parseInt(n || "1", 10) || 1) * 2}d${sides}`)
    : attack.damage;

  const damage = roll(expr, { label: `${attack.name} damage${crit ? " (crit)" : ""}` });
  result.damage = damage;
  result.damageTotal = Math.max(0, damage.total);

  if (target.concentrating && result.damageTotal > 0) {
    const dc = Math.max(10, Math.floor(result.damageTotal / 2));
    const bonus = target.saveBonuses.con ?? abilityMod(target.abilities.con);
    const save = roll(`1d20 ${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}`, {
      label: `${target.name}: concentration`,
    });
    result.concentration = { dc, save, held: save.total >= dc };
  }

  return result;
}

export function rollSave(c: Combatant, ability: keyof AbilityScores, mode: "normal" | "adv" | "dis" = "normal"): RollDetail {
  const bonus = c.saveBonuses[ability] ?? abilityMod(c.abilities[ability]);
  return roll(`1d20 ${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}`, {
    label: `${c.name}: ${ability.toUpperCase()} save`,
    mode,
  });
}

export async function getEncounter(): Promise<Encounter> {
  const stored = await chrome.storage.local.get(ENCOUNTER_KEY);
  const saved = stored[ENCOUNTER_KEY] as Partial<Encounter> | undefined;
  if (!saved) return EMPTY_ENCOUNTER;
  // Encounters saved before attacks/abilities existed still need to load.
  return {
    round: saved.round ?? 1,
    turn: saved.turn ?? 0,
    log: saved.log ?? [],
    combatants: (saved.combatants ?? []).map((c) => ({
      ...blank(c.name ?? "Unnamed"),
      ...c,
      attacks: c.attacks ?? [],
      abilities: c.abilities ?? { ...DEFAULT_ABILITIES },
      saveBonuses: c.saveBonuses ?? {},
    })),
  };
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
