import type { Rule } from "../types";

/**
 * Every entry gets a picture, drawn rather than shipped.
 *
 * The SRD contains no artwork, Open5e's illustrations are explicitly excluded
 * from its licence, and the other datasets only hold remote image URLs — so
 * there is no art set that can legally and offline be bundled for 400+
 * creatures. Instead each entry gets a deterministic emblem: a glyph for what
 * it *is* (creature type, item category, spell school) over a tint and frame
 * derived from a hash of its id, so entries stay individually recognisable
 * and consistent between sessions. Users can override any of these with their
 * own picture — see portraits.ts.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

// Single-stroke glyphs in the same geometric idiom as the interface icons.
const GLYPHS: Record<string, string[]> = {
  // ---- creature types
  aberration: ["M24 8c7 0 11 6 11 12s-4 12-11 12-11-6-11-12 4-12 11-12Z", "M20 20h.01M28 20h.01M18 28c4 3 8 3 12 0"],
  beast: ["M12 30c0-7 5-12 12-12s12 5 12 12", "M14 18l-2-6 6 3M34 18l2-6-6 3", "M20 26h.01M28 26h.01"],
  celestial: ["M24 8l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z", "M24 4v4M24 40v4"],
  construct: ["M14 14h20v20H14z", "M20 20h8v8h-8z", "M24 8v6M24 34v6M8 24h6M34 24h6"],
  dragon: ["M8 26c6-10 14-14 22-12 4 1 8 4 10 8-6-1-10 0-14 3", "M20 22l-6 14 12-6 10 8-2-12", "M30 20h.01"],
  elemental: ["M24 6c6 8 10 13 10 19a10 10 0 0 1-20 0c0-6 4-11 10-19Z", "M24 30a4 4 0 0 0 4-4"],
  fey: ["M12 36c0-14 10-24 24-24 0 14-10 24-24 24Z", "M12 36 27 21", "M36 31l1.6 3.9L41.5 36.5l-3.9 1.6L36 42l-1.6-3.9L30.5 36.5l3.9-1.6Z"],
  fiend: ["M12 12c2 8 6 12 12 12s10-4 12-12", "M14 12l-4-4M34 12l4-4", "M16 30c4 6 12 6 16 0", "M20 26h.01M28 26h.01"],
  giant: ["M18 12a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z", "M8 42c0-9 5-15 10-15s10 6 10 15", "M36 25a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z", "M31 42c0-5 2-8 5-8s5 3 5 8"],
  humanoid: ["M24 10a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z", "M12 40c0-7 5-12 12-12s12 5 12 12"],
  monstrosity: ["M10 30c0-9 6-16 14-16s14 7 14 16", "M14 30l-4 8M34 30l4 8", "M18 24h.01M30 24h.01", "M18 34c4 4 8 4 12 0"],
  ooze: ["M10 30c0-8 6-14 14-14s14 6 14 14c0 5-6 8-14 8s-14-3-14-8Z", "M19 26h.01M29 26h.01"],
  plant: ["M24 40V16", "M24 22c-6 0-10-4-10-10 6 0 10 4 10 10Z", "M24 26c6 0 10-4 10-10-6 0-10 4-10 10Z"],
  swarm: ["M14 16h.01M24 12h.01M34 16h.01M18 26h.01M30 26h.01M24 34h.01M12 30h.01M36 30h.01", "M10 22h.01M38 22h.01"],
  undead: ["M24 6c8 0 13 6 13 13 0 5-3 8-3 11H14c0-3-3-6-3-11 0-7 5-13 13-13Z", "M18 19a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM30 19a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z", "M17 34h14M20 30v4M24 30v4M28 30v4"],

  // ---- item categories
  weapon: ["M24 6l4 6v18h-8V12Z", "M12 30h24", "M24 30v8", "M20 38h8"],
  armor: ["M24 8l14 5v11c0 9-6 15-14 18-8-3-14-9-14-18V13Z"],
  potion: ["M20 8h8v8l6 12v10a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V28l6-12Z", "M14 30h20"],
  ring: ["M24 16a10 10 0 1 1 0 20 10 10 0 0 1 0-20Z", "M20 12h8l-2 5h-4Z"],
  rod: ["M13 35 35 13", "M10 32l6 6M32 10l6 6"],
  scroll: ["M14 10h20v28H14z", "M14 10a4 4 0 0 0 0 8h4M34 38a4 4 0 0 0 0-8h-4", "M20 20h8M20 26h8"],
  staff: ["M24 42V18", "M24 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z", "M20 26l8 4M20 34l8 4"],
  wand: ["M14 38 34 18", "M34 10l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z"],
  wondrous: ["M24 8l5 11 11 5-11 5-5 11-5-11-11-5 11-5Z"],
  amulet: ["M13 9c0 9 5 14 11 14s11-5 11-14", "M24 23l7 8-7 9-7-9Z"],
  cloak: ["M18 10c0 4 12 4 12 0", "M18 10 9 40h30L30 10", "M24 14v26"],
  boots: ["M17 8h10v14c0 4 3 6 8 8l5 2v8H17Z", "M17 32h23"],
  gloves: ["M15 20h18v14a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6Z", "M15 20v-8h18v8", "M21 20v-6M27 20v-6"],
  helm: ["M13 27a11 11 0 0 1 22 0v9a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4Z", "M13 29h22", "M20 33v5M28 33v5"],
  belt: ["M6 20h36v8H6Z", "M20 17v14h9V17Z"],
  vessel: ["M11 20h26l-4 16a4 4 0 0 1-4 3H19a4 4 0 0 1-4-3Z", "M7 20h34", "M24 8v12"],
  horn: ["M34 10v18M20 14v18", "M34 10 20 14", "M20 32a5 4 0 1 1-10 0 5 4 0 0 1 10 0Z", "M34 28a5 4 0 1 1-10 0 5 4 0 0 1 10 0Z"],
  gem: ["M14 10h20l8 10-18 20L6 20Z", "M14 10l4 10h12l4-10", "M6 20h36", "M18 20l6 20M30 20l-6 20"],
  rope: ["M14 14h20a4 4 0 0 1 0 8H14a4 4 0 0 0 0 8h20a4 4 0 0 1 0 8H14"],

  // ---- spell schools
  abjuration: ["M24 8l14 5v11c0 9-6 15-14 18-8-3-14-9-14-18V13Z", "M18 24l4 4 8-8"],
  conjuration: ["M12 40c0-11 5-20 12-20s12 9 12 20", "M24 30V8", "M18 14l6-6 6 6"],
  divination: ["M6 24s7-11 18-11 18 11 18 11-7 11-18 11S6 24 6 24Z", "M24 20a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"],
  enchantment: ["M24 38c-8-6-14-11-14-18a7 7 0 0 1 14-3 7 7 0 0 1 14 3c0 7-6 12-14 18Z"],
  evocation: ["M26 6 12 26h10l-4 16 16-22H24Z"],
  illusion: ["M18 14a11 11 0 1 1 0 22 11 11 0 0 1 0-22Z", "M30 14a11 11 0 0 1 4 6M35 25a11 11 0 0 1-2 7M30 35a11 11 0 0 1-6 1"],
  necromancy: ["M24 6c8 0 13 6 13 13 0 5-3 8-3 11H14c0-3-3-6-3-11 0-7 5-13 13-13Z", "M18 19a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM30 19a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z", "M17 34h14"],
  transmutation: ["M12 18h18a6 6 0 0 1 0 12H16", "M20 12l-8 6 8 6", "M28 24l8 6-8 6"],

  // ---- fallbacks
  rules: ["M12 10h24v28H12z", "M18 10v28M12 18h6M12 26h6", "M24 18h8M24 26h8"],
  classes: ["M22 12a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z", "M10 40c0-7 5-12 12-12s12 5 12 12", "M36 6l6 2v5c0 4-3 6-6 7-3-1-6-3-6-7V8Z"],
  unknown: ["M24 10a14 14 0 1 1 0 28 14 14 0 0 1 0-28Z", "M24 30h.01M20 20a4 4 0 1 1 6 3.5c-1 .8-2 1.5-2 2.5"],
};

/**
 * First match wins, so the more specific shapes come before the broad ones —
 * "Boots of Elvenkind" should read as boots, not fall through to the generic
 * wondrous star along with everything else in that category.
 */
const ITEM_KEYS: [RegExp, string][] = [
  [/weapon|sword|axe|bow(?!l)|blowgun|dagger|hammer|mace|spear|lance|whip|club|flail|glaive|halberd|pike|rapier|scimitar|trident|crossbow|sling|dart|javelin|maul|morningstar|quarterstaff|sickle/, "weapon"],
  [/armor|armour|shield|mail|plate|leather/, "armor"],
  [/potion|oil|elixir|philter/, "potion"],
  [/ring/, "ring"],
  [/rod/, "rod"],
  [/scroll|book|tome|manual/, "scroll"],
  [/staff/, "staff"],
  [/wand/, "wand"],
  [/amulet|necklace|pendant|periapt|talisman|medallion|brooch|scarab|locket/, "amulet"],
  [/cloak|robe|mantle|cape|vestment|shawl/, "cloak"],
  [/boots|slippers|sandals|shoes/, "boots"],
  [/gloves|gauntlets|bracers|vambraces|mitts/, "gloves"],
  [/helm|hat|crown|circlet|diadem|mask|goggles|lenses|headband|hood/, "helm"],
  [/belt|girdle|sash/, "belt"],
  [/bag|pouch|sack|haversack|bowl|bottle|flask|decanter|jar|chalice|censer|lantern|lamp/, "vessel"],
  [/horn|pipes|flute|drum|lute|lyre|harp|whistle|bell|chime/, "horn"],
  [/gem|stone|crystal|pearl|bead|orb|sphere|prism|figurine|token|feather|dust|ioun/, "gem"],
  [/rope|chain|carpet|tapestry|cord|ladder|sheet/, "rope"],
];

/** Picks the glyph that says what this entry actually is. */
export function glyphKey(rule: Rule): string {
  if (rule.monster) {
    const type = rule.category.toLowerCase();
    if (/swarm/.test(rule.title.toLowerCase())) return "swarm";
    return GLYPHS[type] ? type : "monstrosity";
  }
  if (rule.spell) {
    const school = rule.spell.school.toLowerCase();
    return GLYPHS[school] ? school : "evocation";
  }
  if (rule.group === "items") {
    const haystack = `${rule.category} ${rule.title} ${rule.item?.kind ?? ""}`.toLowerCase();
    for (const [pattern, key] of ITEM_KEYS) if (pattern.test(haystack)) return key;
    return "wondrous";
  }
  if (rule.group === "classes") return "classes";
  if (rule.group === "rules") return "rules";
  return "unknown";
}

/** Stable small hash, so an entry looks the same every session. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function path(d: string, width: number): SVGPathElement {
  const node = document.createElementNS(SVG_NS, "path");
  node.setAttribute("d", d);
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", String(width));
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  return node;
}

export type EmblemOptions = { size?: number; portrait?: string };

/**
 * Builds the entry's picture: their own uploaded portrait if they have set
 * one, otherwise the generated emblem.
 */
export function emblem(rule: Rule, options: EmblemOptions = {}): HTMLElement {
  return emblemFor(rule.id, glyphKey(rule), options);
}

/**
 * The same picture for things that aren't catalogue entries — a party member,
 * say — where the caller knows the seed and the glyph itself.
 */
export function emblemFor(seedKey: string, glyph: string, options: EmblemOptions = {}): HTMLElement {
  const size = options.size ?? 40;
  const wrap = document.createElement("span");
  wrap.className = "emblem";
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;

  if (options.portrait) {
    const img = document.createElement("img");
    img.src = options.portrait;
    img.alt = "";
    wrap.append(img);
    return wrap;
  }

  const seed = hash(seedKey);
  // Four tints from the accent ramp keep variety inside the theme's palette
  // rather than scattering arbitrary hues across the list.
  const tints = ["var(--color-accent-200)", "var(--color-accent-300)", "var(--color-accent-100)", "var(--color-surface)"];
  wrap.style.background = tints[seed % tints.length];
  wrap.dataset.tone = String(seed % 4);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");

  for (const d of GLYPHS[glyph] ?? GLYPHS.unknown) {
    svg.append(path(d, size >= 56 ? 1.6 : 2));
  }

  // A quiet corner tick, rotated by the hash, so same-type entries still
  // differ from each other at a glance.
  const tick = document.createElementNS(SVG_NS, "path");
  tick.setAttribute("d", "M4 4h5M4 4v5");
  tick.setAttribute("fill", "none");
  tick.setAttribute("stroke", "currentColor");
  tick.setAttribute("stroke-width", "1.5");
  tick.setAttribute("opacity", "0.5");
  tick.setAttribute("transform", `rotate(${(seed % 4) * 90} 24 24)`);
  svg.append(tick);

  wrap.append(svg);
  return wrap;
}
