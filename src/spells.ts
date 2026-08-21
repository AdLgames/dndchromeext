import type { Rule } from "./types";

/**
 * What a spell does to the map, and how it grows when cast higher.
 *
 * Both are read out of the spell's own prose, which is where 5e keeps them —
 * there is no structured field for either. Kept DOM-free so the parsing can
 * be tested directly, and deliberately conservative: a spell whose wording
 * is not recognised simply gets no diagram and no upcast control, rather
 * than a wrong one.
 */

export type ShapeKind =
  | "cone" | "sphere" | "cylinder" | "cube" | "square" | "line" | "radius"
  | "target" | "touch" | "self";

export type SpellShape = {
  kind: ShapeKind;
  /** Feet: radius for round shapes, side for square ones, length for a line. */
  size: number;
  /** Second dimension where the shape has one — a line's width, a cylinder's height. */
  extent?: number;
  label: string;
};

const SHAPES: { kind: ShapeKind; re: RegExp; label: (m: RegExpExecArray) => string }[] = [
  { kind: "cone", re: /(\d+)[-\s]foot cone/i, label: (m) => `${m[1]} ft cone` },
  {
    kind: "cylinder",
    re: /(\d+)[-\s]foot[-\s]radius,?\s*(\d+)[-\s]foot[-\s]tall cylinder/i,
    label: (m) => `${m[1]} ft radius, ${m[2]} ft tall`,
  },
  { kind: "sphere", re: /(\d+)[-\s]foot[-\s]radius sphere/i, label: (m) => `${m[1]} ft radius sphere` },
  { kind: "cube", re: /(\d+)[-\s]foot cube/i, label: (m) => `${m[1]} ft cube` },
  { kind: "square", re: /(\d+)[-\s]foot square/i, label: (m) => `${m[1]} ft square` },
  {
    // Both dimensions spelled out. Checked before the looser rule below,
    // which would otherwise match at the earlier "line" and lose the width.
    kind: "line",
    re: /(\d+) feet long and (\d+) feet wide/i,
    label: (m) => `${m[1]} × ${m[2]} ft line`,
  },
  {
    // "long" alone is not enough — Rope Trick's rope is 60 feet long. The
    // wording has to be about a line or a wall for this to be an area.
    kind: "line",
    re: /(?:line|wall)\b[^.]{0,80}?(\d+) feet long|(\d+) feet long[^.]{0,40}?\b(?:line|wall)\b/i,
    label: (m) => `${m[1] ?? m[2]} ft line`,
  },
  { kind: "radius", re: /(\d+)[-\s]foot[-\s]radius/i, label: (m) => `${m[1]} ft radius` },
];

/** The area a spell covers, or how it reaches a single target. */
export function spellShape(rule: Rule): SpellShape | null {
  if (!rule.spell) return null;
  const text = rule.body ?? "";

  for (const { kind, re, label } of SHAPES) {
    const m = re.exec(text);
    if (!m) continue;

    if (kind === "line") {
      // The wide form captures both; the loose form only a length, and 5 ft
      // is the width the rules assume when they do not say.
      const both = m[2] !== undefined && /wide/i.test(m[0]);
      const size = Number(both ? m[1] : (m[1] ?? m[2]));
      return { kind, size, extent: both ? Number(m[2]) : 5, label: label(m) };
    }
    if (kind === "cylinder") {
      return { kind, size: Number(m[1]), extent: Number(m[2]), label: label(m) };
    }
    return { kind, size: Number(m[1]), label: label(m) };
  }

  // No area: say how it reaches instead, which is just as worth showing.
  const range = rule.spell.range.trim().toLowerCase();
  if (range === "self") return { kind: "self", size: 0, label: "Self" };
  if (range === "touch") return { kind: "touch", size: 5, label: "Touch" };

  const feet = /^(\d+)\s*(?:feet|foot|ft)/.exec(range);
  if (feet) return { kind: "target", size: Number(feet[1]), label: `${feet[1]} ft, single target` };

  return null;
}

// ------------------------------------------------------------- upcasting --

export type SpellScaling =
  /** A levelled spell that grows per slot above its own level. */
  | { kind: "slot"; base: string; per: string; baseLevel: number; flat?: number }
  /** A cantrip that grows at fixed character levels. */
  | { kind: "cantrip"; base: string; steps: { level: number; dice: string }[] };

const DICE = /\b(\d{1,3}d\d{1,3})\b/;

/** "increases by 1d6 for each slot level above 3rd" */
const PER_SLOT = /increases? by (\d{1,3}d\d{1,3})[^.]{0,80}?for each slot level above (\d+)/i;
/**
 * "a target's hit points increase by 5 for each slot level above 2nd".
 * What is increasing has to be named, or this also matches the spells whose
 * duration goes up by an hour a slot, which is not something to roll.
 */
const PER_SLOT_FLAT =
  /\b(?:hit points|damage|healing)\b[^.]{0,40}?increase(?:s)? by (\d{1,3})(?!d)[^.]{0,60}?for each slot level above (\d+)/i;
/** "1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10)" */
const CANTRIP_STEP = /(\d{1,3})(?:st|nd|rd|th) level \((\d{1,3}d\d{1,3})\)/gi;

/**
 * How a spell's dice grow. Damage and healing both scale the same way and are
 * treated alike; anything that scales duration, range or targets instead is
 * left alone, since there is nothing to roll.
 */
export function spellScaling(rule: Rule): SpellScaling | null {
  const spell = rule.spell;
  if (!spell) return null;

  const base = DICE.exec(rule.body ?? "")?.[1];
  if (!base) return null;

  if (spell.level === 0) {
    const steps: { level: number; dice: string }[] = [];
    CANTRIP_STEP.lastIndex = 0;
    for (let m = CANTRIP_STEP.exec(rule.body ?? ""); m; m = CANTRIP_STEP.exec(rule.body ?? "")) {
      steps.push({ level: Number(m[1]), dice: m[2] });
    }
    return steps.length ? { kind: "cantrip", base, steps } : null;
  }

  const higher = spell.higherLevel ?? "";
  const dice = PER_SLOT.exec(higher);
  if (dice) return { kind: "slot", base, per: dice[1], baseLevel: Number(dice[2]) };

  const flat = PER_SLOT_FLAT.exec(higher);
  if (flat) {
    return { kind: "slot", base, per: "", baseLevel: Number(flat[2]), flat: Number(flat[1]) };
  }

  return null;
}

/** Multiplies a dice expression: 3 × "1d6" is "3d6". */
function times(expr: string, count: number): string {
  const m = /^(\d*)d(\d+)$/.exec(expr);
  if (!m || count <= 0) return "";
  return `${(Number(m[1] || 1) * count)}d${m[2]}`;
}

/** Adds two dice expressions of the same size: "8d6" + "2d6" is "10d6". */
function add(a: string, b: string): string {
  if (!b) return a;
  if (!a) return b;
  const x = /^(\d*)d(\d+)$/.exec(a);
  const y = /^(\d*)d(\d+)$/.exec(b);
  if (!x || !y || x[2] !== y[2]) return `${a} + ${b}`;
  return `${Number(x[1] || 1) + Number(y[1] || 1)}d${x[2]}`;
}

/** What to roll when the spell is cast at `level`. */
export function diceAtLevel(scaling: SpellScaling, level: number): { expr: string; note?: string } {
  if (scaling.kind === "cantrip") {
    const reached = scaling.steps.filter((s) => s.level <= level);
    const best = reached[reached.length - 1];
    return { expr: best ? best.dice : scaling.base };
  }

  const above = Math.max(0, level - scaling.baseLevel);
  if (scaling.flat !== undefined) {
    const bonus = scaling.flat * above;
    return { expr: scaling.base, note: bonus ? `+${bonus} on top` : undefined };
  }
  return { expr: add(scaling.base, times(scaling.per, above)) };
}
