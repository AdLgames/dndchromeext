export type RollDetail = {
  expr: string;
  label?: string;
  total: number;
  dice: { sides: number; values: number[]; dropped?: number[] }[];
  modifier: number;
  crit?: "hit" | "miss";
  at: number;
};

/**
 * Matches dice expressions in prose: "1d6", "2d6 + 4", "8d6", "1d10 + 2".
 * Deliberately conservative — it must not light up every number in a
 * stat block, only things that are actually rollable.
 */
export const DICE_RE = /\b(\d{0,3})d(\d{1,3})(\s*[+-]\s*\d{1,3})?\b/gi;

const rand = (sides: number): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % sides) + 1;
};

export function isDiceExpression(text: string): boolean {
  DICE_RE.lastIndex = 0;
  const match = DICE_RE.exec(text.trim());
  return !!match && match[0].trim().length === text.trim().length;
}

/** Rolls "NdM+K". `mode` applies advantage/disadvantage to a d20. */
export function roll(
  expr: string,
  opts: { label?: string; mode?: "normal" | "adv" | "dis" } = {}
): RollDetail {
  DICE_RE.lastIndex = 0;
  const match = DICE_RE.exec(expr);
  if (!match) {
    return { expr, label: opts.label, total: 0, dice: [], modifier: 0, at: Date.now() };
  }

  const count = Math.max(1, Math.min(50, parseInt(match[1] || "1", 10)));
  const sides = Math.max(2, Math.min(1000, parseInt(match[2], 10)));
  const modifier = match[3] ? parseInt(match[3].replace(/\s+/g, ""), 10) : 0;
  const mode = opts.mode ?? "normal";

  const dice: RollDetail["dice"] = [];
  let subtotal = 0;

  if (mode !== "normal" && sides === 20 && count === 1) {
    const pair = [rand(20), rand(20)];
    const keep = mode === "adv" ? Math.max(...pair) : Math.min(...pair);
    dice.push({ sides, values: [keep], dropped: [pair[0] === keep ? pair[1] : pair[0]] });
    subtotal = keep;
  } else {
    const values = Array.from({ length: count }, () => rand(sides));
    dice.push({ sides, values });
    subtotal = values.reduce((a, b) => a + b, 0);
  }

  const natural = sides === 20 && dice[0].values.length === 1 ? dice[0].values[0] : undefined;

  return {
    expr,
    label: opts.label,
    total: subtotal + modifier,
    dice,
    modifier,
    crit: natural === 20 ? "hit" : natural === 1 ? "miss" : undefined,
    at: Date.now(),
  };
}

/** "1d6 per 10 feet" style: rolls `per` copies of the base expression. */
export function rollRepeated(expr: string, times: number, label?: string): RollDetail {
  const safe = Math.max(1, Math.min(20, times));
  DICE_RE.lastIndex = 0;
  const match = DICE_RE.exec(expr);
  if (!match) return roll(expr, { label });
  const count = parseInt(match[1] || "1", 10) * safe;
  return roll(`${count}d${match[2]}${match[3] ?? ""}`, { label });
}

export function formatRoll(detail: RollDetail): string {
  const parts = detail.dice
    .map((d) => `${d.values.join(", ")}${d.dropped?.length ? ` (dropped ${d.dropped.join(", ")})` : ""}`)
    .join(" · ");
  const mod = detail.modifier ? ` ${detail.modifier > 0 ? "+" : "−"} ${Math.abs(detail.modifier)}` : "";
  return `[${parts}]${mod}`;
}

const LOG_KEY = "rulesOverlay:rollLog";
const LOG_MAX = 30;

export async function getRollLog(): Promise<RollDetail[]> {
  const stored = await chrome.storage.local.get(LOG_KEY);
  return (stored[LOG_KEY] as RollDetail[] | undefined) ?? [];
}

export async function pushRoll(detail: RollDetail): Promise<RollDetail[]> {
  const log = [detail, ...(await getRollLog())].slice(0, LOG_MAX);
  await chrome.storage.local.set({ [LOG_KEY]: log });
  return log;
}

export function onRollLogChanged(fn: (log: RollDetail[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LOG_KEY]) fn(changes[LOG_KEY].newValue ?? []);
  });
}

export async function clearRollLog(): Promise<void> {
  await chrome.storage.local.remove(LOG_KEY);
}
