import { roll, type RollDetail } from "./dice";
import type {
  AbilityScores, ActionCost, Character, Combatant, CombatAction, CombatEvent,
  Encounter, Rule, StatBlock,
} from "./types";

const ENCOUNTER_KEY = "rulesOverlay:encounter";
const LOG_MAX = 40;

export const EMPTY_ENCOUNTER: Encounter = {
  round: 1, turn: 0, combatants: [], log: [], order: [], started: false, dmOverride: false,
};

const DEFAULT_ABILITIES: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** 5e proficiency progression: +2 at level 1, +1 every four levels after. */
export function proficiencyForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/** Which ability a class casts off, so spell attacks and DCs come out right. */
export function spellAbilityForClass(className: string): keyof AbilityScores | undefined {
  const name = className.toLowerCase();
  if (/wizard|artificer/.test(name)) return "int";
  if (/cleric|druid|ranger|monk/.test(name)) return "wis";
  if (/bard|sorcerer|warlock|paladin/.test(name)) return "cha";
  return undefined;
}

function id(prefix = "k"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blank(name: string): Combatant {
  return {
    id: id(), name, initiative: 0, ac: 10, hp: 10, maxHp: 10, tempHp: 0,
    speed: 30, movementUsed: 0, conditions: [], concentrating: false,
    concentrationNote: "", reactionUsed: false,
    deathSaves: { successes: 0, failures: 0 }, isPlayer: false,
    actions: [], abilities: { ...DEFAULT_ABILITIES }, saveBonuses: {},
    profBonus: 2, actionUsed: false, bonusUsed: false,
  };
}

/** Pulls "Hit: 7 (1d10 + 2)" out of an action's prose so it can be rolled. */
export function damageFromDesc(desc: string): string | undefined {
  const hit = /Hit:\s*\d+\s*\(([^)]+)\)/i.exec(desc);
  if (hit) return hit[1].trim();
  const bare = /\b(\d{0,3}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)\b/.exec(desc);
  return bare?.[1];
}

const DAMAGE_TYPE_RE =
  /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i;

export function actionsFromStatBlock(stat: StatBlock): CombatAction[] {
  const actions: CombatAction[] = [];
  for (const entry of stat.actions) {
    const damage = damageFromDesc(entry.desc);
    if (!damage) continue;
    const saveMatch = /DC\s*(\d+)\s*(\w{3})/i.exec(entry.value ?? entry.desc);
    const isSave = entry.value?.startsWith("DC");

    actions.push({
      id: id("a"),
      name: entry.name,
      kind: "weapon",
      cost: "action",
      ...(isSave
        ? {
            saveDC: saveMatch ? Number(saveMatch[1]) : undefined,
            saveAbility: saveMatch ? (saveMatch[2].toLowerCase() as keyof AbilityScores) : undefined,
            saveEffect: /half as much/i.test(entry.desc) ? ("half" as const) : ("none" as const),
          }
        : { bonus: entry.value?.startsWith("+") ? parseInt(entry.value, 10) : 0 }),
      damage,
      damageType: DAMAGE_TYPE_RE.exec(entry.desc)?.[1]?.toLowerCase(),
      melee: /melee/i.test(entry.label ?? ""),
      note: entry.label,
    });
  }
  return actions;
}

// ------------------------------------------- character sheet -> actions ---
const FINESSE_RE = /\bfinesse\b/i;
const RANGED_RE = /\b(ranged|ammunition|thrown)\b/i;

/**
 * Turns a character's stored weapons, spells and items into things they can
 * actually do in the tracker, deriving the numbers the way 5e does: ability
 * modifier plus proficiency, with the weapon's own properties deciding which
 * ability applies. These are a starting point a DM can edit, not gospel.
 */
export function actionsFromCharacter(character: Character, rules: Map<string, Rule>): CombatAction[] {
  const prof = proficiencyForLevel(character.level);
  const mod = (key: keyof AbilityScores) => abilityMod(character.abilities[key]);
  const spellAbility = spellAbilityForClass(character.className);
  const actions: CombatAction[] = [];

  const weaponish = (rule: Rule): CombatAction | null => {
    const damage = damageFromDesc(rule.body);
    if (!damage) return null;
    const ranged = RANGED_RE.test(rule.body);
    const finesse = FINESSE_RE.test(rule.body);
    const ability: keyof AbilityScores =
      ranged || (finesse && mod("dex") > mod("str")) ? "dex" : "str";

    return {
      id: id("a"),
      name: rule.title,
      kind: "weapon",
      cost: "action",
      bonus: mod(ability) + prof,
      damage: `${damage} + ${mod(ability)}`.replace("+ -", "- "),
      damageType: DAMAGE_TYPE_RE.exec(rule.body)?.[1]?.toLowerCase(),
      melee: !ranged,
      ruleId: rule.id,
      note: `${ability.toUpperCase()} + prof ${prof}`,
    };
  };

  const spellAction = (rule: Rule): CombatAction => {
    const damage = damageFromDesc(rule.body);
    const saveAbility = /(\w+) saving throw/i.exec(rule.body)?.[1]?.slice(0, 3).toLowerCase();
    const usesSave = !!saveAbility && !/spell attack/i.test(rule.body);
    const casting = rule.spell?.castingTime ?? "1 action";
    const cost: ActionCost = /bonus action/i.test(casting)
      ? "bonus"
      : /reaction/i.test(casting)
        ? "reaction"
        : "action";

    return {
      id: id("a"),
      name: rule.title,
      kind: "spell",
      cost,
      ...(usesSave && spellAbility
        ? {
            saveDC: 8 + mod(spellAbility) + prof,
            saveAbility: saveAbility as keyof AbilityScores,
            saveEffect: /half as much/i.test(rule.body) ? ("half" as const) : ("none" as const),
          }
        : spellAbility
          ? { bonus: mod(spellAbility) + prof }
          : {}),
      ...(damage ? { damage } : {}),
      damageType: DAMAGE_TYPE_RE.exec(rule.body)?.[1]?.toLowerCase(),
      ruleId: rule.id,
      note: rule.subtitle,
    };
  };

  for (const entry of character.items) {
    const rule = entry.ruleId ? rules.get(entry.ruleId) : undefined;
    const derived = rule ? weaponish(rule) : null;
    actions.push(derived ?? {
      id: id("a"), name: entry.name, kind: "item", cost: "action",
      ruleId: entry.ruleId, note: entry.note,
    });
  }

  for (const entry of character.spells) {
    const rule = entry.ruleId ? rules.get(entry.ruleId) : undefined;
    actions.push(rule ? spellAction(rule) : {
      id: id("a"), name: entry.name, kind: "spell", cost: "action",
      ruleId: entry.ruleId, note: entry.note,
    });
  }

  for (const entry of character.actions) {
    const rule = entry.ruleId ? rules.get(entry.ruleId) : undefined;
    actions.push({
      id: id("a"), name: entry.name, kind: "other", cost: "action",
      ruleId: rule?.id, note: entry.note,
    });
  }

  return actions;
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
    actions: actionsFromStatBlock(m),
    saveBonuses,
    profBonus: m.prof,
  };
}

export function combatantFromCharacter(character: Character, rules: Map<string, Rule>): Combatant {
  return {
    ...blank(character.name),
    ac: character.ac,
    hp: character.hp,
    maxHp: character.maxHp,
    speed: character.speed,
    isPlayer: true,
    characterId: character.id,
    abilities: character.abilities,
    level: character.level,
    profBonus: proficiencyForLevel(character.level),
    spellAbility: spellAbilityForClass(character.className),
    actions: actionsFromCharacter(character, rules),
  };
}

export function combatantBlank(name: string): Combatant {
  return blank(name);
}

// -------------------------------------------------- conditions as rules ---
/** Conditions that stop a creature acting at all. */
const CANT_ACT = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];
/** Conditions that drop speed to 0. */
const SPEED_ZERO = ["grappled", "restrained", "paralyzed", "petrified", "stunned", "unconscious"];
/** Attacking while suffering these is at disadvantage. */
const ATTACKER_DISADV = ["blinded", "frightened", "poisoned", "prone", "restrained"];
/** Being these grants attackers advantage. */
const TARGET_ADV = ["blinded", "paralyzed", "petrified", "restrained", "stunned", "unconscious"];
/** A hit from within 5 ft on these is automatically a critical. */
const AUTO_CRIT = ["paralyzed", "unconscious"];

export function canAct(c: Combatant): boolean {
  return !c.conditions.some((id) => CANT_ACT.includes(id)) && c.hp > 0;
}

export function effectiveSpeed(c: Combatant): number {
  return c.conditions.some((id) => SPEED_ZERO.includes(id)) ? 0 : c.speed;
}

export type RollShape = { mode: "normal" | "adv" | "dis"; reasons: string[]; autoCrit: boolean };

/**
 * Works out advantage, disadvantage and auto-crits from the conditions in
 * play, then applies 5e's cancellation rule: any advantage against any
 * disadvantage leaves a plain roll, however many of each there are.
 */
export function attackShape(
  attacker: Combatant,
  target: Combatant,
  action: CombatAction,
  requested: "normal" | "adv" | "dis" = "normal"
): RollShape {
  const reasons: string[] = [];
  let adv = requested === "adv";
  let dis = requested === "dis";
  if (requested !== "normal") reasons.push(`chosen ${requested === "adv" ? "advantage" : "disadvantage"}`);

  for (const id of attacker.conditions) {
    if (ATTACKER_DISADV.includes(id)) { dis = true; reasons.push(`attacker ${id}`); }
    if (id === "invisible") { adv = true; reasons.push("attacker invisible"); }
  }
  for (const id of target.conditions) {
    if (TARGET_ADV.includes(id)) { adv = true; reasons.push(`target ${id}`); }
    if (id === "invisible") { dis = true; reasons.push("target invisible"); }
    if (id === "prone") {
      if (action.melee) { adv = true; reasons.push("target prone (melee)"); }
      else { dis = true; reasons.push("target prone (ranged)"); }
    }
  }

  const autoCrit = !!action.melee && target.conditions.some((id) => AUTO_CRIT.includes(id));
  if (autoCrit) reasons.push("auto-crit within 5 ft");

  const mode = adv && dis ? "normal" : adv ? "adv" : dis ? "dis" : "normal";
  if (adv && dis) reasons.push("advantage and disadvantage cancel");
  return { mode, reasons, autoCrit };
}

/** Initiative order: highest first, ties broken stably by name. */
export function ordered(encounter: Encounter): Combatant[] {
  if (encounter.started && encounter.order.length) {
    const byId = new Map(encounter.combatants.map((c) => [c.id, c]));
    const inOrder = encounter.order.map((cid) => byId.get(cid)).filter((c): c is Combatant => !!c);
    // Anyone added mid-fight isn't in the stored order yet; show them last.
    const extra = encounter.combatants.filter((c) => !encounter.order.includes(c.id));
    return [...inOrder, ...extra];
  }
  return [...encounter.combatants].sort(
    (a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name)
  );
}

export function activeCombatant(encounter: Encounter): Combatant | undefined {
  const list = ordered(encounter);
  return list[encounter.turn];
}

/** Rolls initiative for everyone at once and freezes the resulting order. */
export function rollInitiativeForAll(encounter: Encounter): { encounter: Encounter; rolls: RollDetail[] } {
  const rolls: RollDetail[] = [];
  const combatants = encounter.combatants.map((c) => {
    const bonus = abilityMod(c.abilities.dex);
    const detail = roll(`1d20 ${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}`, {
      label: `${c.name}: initiative`,
    });
    rolls.push(detail);
    return { ...c, initiative: detail.total, actionUsed: false, bonusUsed: false, movementUsed: 0 };
  });

  const order = [...combatants]
    .sort((a, b) => b.initiative - a.initiative || abilityMod(b.abilities.dex) - abilityMod(a.abilities.dex))
    .map((c) => c.id);

  let next: Encounter = {
    ...encounter, combatants, order, started: true, round: 1, turn: 0,
  };
  next = logEvent(next, {
    kind: "note",
    text: "Initiative rolled",
    detail: order
      .map((cid, i) => `${i + 1}. ${combatants.find((c) => c.id === cid)?.name} (${combatants.find((c) => c.id === cid)?.initiative})`)
      .join("  "),
  });
  return { encounter: next, rolls };
}

/**
 * Advances the turn. Action, bonus action, reaction and movement all reset at
 * the start of a combatant's own turn, which is when 5e refreshes them.
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
    c.id === active.id
      ? { ...c, movementUsed: 0, reactionUsed: false, actionUsed: false, bonusUsed: false }
      : c
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
  const conditions = hp === 0 && !c.conditions.includes("unconscious")
    ? [...c.conditions, "unconscious", ...(c.conditions.includes("prone") ? [] : ["prone"])]
    : c.conditions;
  return { ...c, tempHp: c.tempHp - absorbed, hp, conditions };
}

export function applyHealing(c: Combatant, amount: number): Combatant {
  const hp = Math.min(c.maxHp, c.hp + amount);
  if (hp === c.hp) return c;
  return {
    ...c,
    hp,
    // Coming back up ends unconsciousness and wipes the death-save tally.
    conditions: hp > 0 ? c.conditions.filter((id) => id !== "unconscious") : c.conditions,
    deathSaves: hp > 0 ? { successes: 0, failures: 0 } : c.deathSaves,
  };
}

export type ActionResult = {
  shape: RollShape;
  attackRoll?: RollDetail;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  save?: { dc: number; ability: keyof AbilityScores; roll: RollDetail; passed: boolean };
  damage?: RollDetail;
  damageTotal: number;
  concentration?: { dc: number; save: RollDetail; held: boolean };
};

function doubleDice(expr: string): string {
  return expr.replace(/\b(\d{0,3})d(\d{1,3})\b/i, (_m, n: string, sides: string) =>
    `${(parseInt(n || "1", 10) || 1) * 2}d${sides}`);
}

/**
 * Resolves one action against one target, covering both 5e shapes: an attack
 * roll against AC (criticals double the dice, not the modifier) or a saving
 * throw against a DC (a success halves or avoids the damage). Conditions in
 * play decide advantage, disadvantage and auto-criticals.
 */
export function resolveAction(
  attacker: Combatant,
  action: CombatAction,
  target: Combatant,
  requested: "normal" | "adv" | "dis" = "normal"
): ActionResult {
  const shape = attackShape(attacker, target, action, requested);
  const result: ActionResult = { shape, hit: false, crit: false, fumble: false, damageTotal: 0 };

  if (action.saveDC !== undefined && action.saveAbility) {
    const ability = action.saveAbility;
    const bonus = target.saveBonuses[ability] ?? abilityMod(target.abilities[ability]);
    const saveRoll = roll(`1d20 ${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}`, {
      label: `${target.name}: ${ability.toUpperCase()} save`,
    });
    const passed = saveRoll.total >= action.saveDC;
    result.save = { dc: action.saveDC, ability, roll: saveRoll, passed };
    result.hit = !passed || action.saveEffect === "half";

    if (action.damage) {
      const damage = roll(action.damage, { label: `${action.name} damage` });
      result.damage = damage;
      result.damageTotal = passed
        ? action.saveEffect === "half" ? Math.floor(Math.max(0, damage.total) / 2) : 0
        : Math.max(0, damage.total);
    }
  } else if (action.bonus !== undefined) {
    const attackRoll = roll(`1d20 ${action.bonus >= 0 ? "+" : "-"} ${Math.abs(action.bonus)}`, {
      label: `${attacker.name}: ${action.name}`,
      mode: shape.mode,
    });
    result.attackRoll = attackRoll;

    const natural = attackRoll.dice[0]?.values[0] ?? 0;
    result.fumble = natural === 1;
    result.crit = natural === 20 || (shape.autoCrit && !result.fumble && attackRoll.total >= target.ac);
    result.hit = natural === 20 || (!result.fumble && attackRoll.total >= target.ac);

    if (result.hit && action.damage) {
      const damage = roll(result.crit ? doubleDice(action.damage) : action.damage, {
        label: `${action.name} damage${result.crit ? " (crit)" : ""}`,
      });
      result.damage = damage;
      result.damageTotal = Math.max(0, damage.total);
    }
  } else if (action.damage) {
    // No attack roll and no save: healing potions, magic missile and friends.
    const damage = roll(action.damage, { label: `${action.name}` });
    result.damage = damage;
    result.damageTotal = Math.max(0, damage.total);
    result.hit = true;
  }

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

export function rollSave(
  c: Combatant, ability: keyof AbilityScores, mode: "normal" | "adv" | "dis" = "normal"
): RollDetail {
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
  // Encounters saved by earlier versions predate several of these fields.
  return {
    round: saved.round ?? 1,
    turn: saved.turn ?? 0,
    log: saved.log ?? [],
    order: saved.order ?? [],
    started: saved.started ?? false,
    dmOverride: saved.dmOverride ?? false,
    combatants: (saved.combatants ?? []).map((c) => ({
      ...blank(c.name ?? "Unnamed"),
      ...c,
      actions: c.actions ?? [],
      abilities: c.abilities ?? { ...DEFAULT_ABILITIES },
      saveBonuses: c.saveBonuses ?? {},
      profBonus: c.profBonus ?? 2,
      actionUsed: c.actionUsed ?? false,
      bonusUsed: c.bonusUsed ?? false,
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
