import type { StatBlock } from "./types";

/**
 * Approximate monster scaling. The SRD has no official rules for this, so
 * this is deliberately labelled homebrew in the UI: it nudges the numbers
 * a DM would otherwise adjust by hand rather than claiming to be RAW.
 */

const CR_ORDER = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

export function crToNumber(cr: string): number {
  if (cr.includes("/")) {
    const [a, b] = cr.split("/").map(Number);
    return b ? a / b : 0;
  }
  return Number(cr) || 0;
}

export function crToLabel(value: number): string {
  if (value <= 0) return "0";
  if (value <= 0.125) return "1/8";
  if (value <= 0.25) return "1/4";
  if (value <= 0.5) return "1/2";
  return String(Math.round(value));
}

/** Steps a CR up or down the official ladder rather than by raw arithmetic. */
export function shiftCr(cr: string, delta: number): string {
  const current = crToNumber(cr);
  let index = CR_ORDER.findIndex((c) => c >= current);
  if (index === -1) index = CR_ORDER.length - 1;
  const next = Math.max(0, Math.min(CR_ORDER.length - 1, index + delta));
  return crToLabel(CR_ORDER[next]);
}

/** Multiplies every dice count in a string: "2d6 + 3" at 1.6 -> "3d6 + 3". */
export function scaleDice(text: string, factor: number): string {
  return text.replace(/\b(\d{0,3})d(\d{1,3})\b/gi, (_match, count: string, sides: string) => {
    const n = Math.max(1, Math.round((parseInt(count || "1", 10) || 1) * factor));
    return `${n}d${sides}`;
  });
}

export function scaleStatBlock(stat: StatBlock, delta: number): StatBlock {
  if (!delta) return stat;

  const factor = Math.max(0.2, 1 + delta * 0.3);
  const flat = Math.round(delta / 2);
  const bump = (value?: string) =>
    value?.replace(/([+-])(\d+)/, (_m, sign: string, n: string) => {
      const next = (sign === "-" ? -Number(n) : Number(n)) + flat;
      return next >= 0 ? `+${next}` : String(next);
    });
  const bumpDc = (value?: string) =>
    value?.replace(/DC\s*(\d+)/i, (_m, n: string) => `DC ${Math.max(1, Number(n) + flat)}`);

  return {
    ...stat,
    ac: Math.max(1, stat.ac + flat),
    hp: Math.max(1, Math.round(stat.hp * factor)),
    hitDice: stat.hitDice ? scaleDice(stat.hitDice, factor) : stat.hitDice,
    cr: shiftCr(stat.cr, delta),
    xp: Math.max(0, Math.round(stat.xp * factor * factor)),
    prof: Math.max(2, stat.prof + Math.round(delta / 3)),
    actions: stat.actions.map((action) => ({
      ...action,
      // `value` is the surfaced attack bonus or save DC; inside the prose
      // only the dice and any DC are touched, since the other "+N" there is
      // a damage modifier rather than something scaling implies.
      value: action.value?.startsWith("DC") ? bumpDc(action.value) : bump(action.value),
      desc: scaleDice(bumpDc(action.desc) ?? action.desc, factor),
    })),
    legendary: stat.legendary.map((entry) => ({ ...entry, desc: scaleDice(entry.desc, factor) })),
    reactions: stat.reactions.map((entry) => ({ ...entry, desc: scaleDice(entry.desc, factor) })),
  };
}
