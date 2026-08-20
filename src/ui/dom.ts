import { DICE_RE } from "../dice";
import { parseBlocks } from "./markup";

type Props = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Terse element builder. Text goes through textContent — never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string | null | undefined)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide-style line icons at stroke-width 1.5, per the design system. */
export const ICONS = {
  diamond: ["M12 2.5 21.5 12 12 21.5 2.5 12Z"],
  pin: ["M12 17v5M9 3h6l-1 8h3l-5 6-5-6h3Z"],
  close: ["M18 6 6 18M6 6l12 12"],
  back: ["M20 12H4M10 6l-6 6 6 6"],
  settings: ["M4 7h10M18 7h2M4 17h2M10 17h10", "M16 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM8 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"],
  search: ["M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z", "m16.5 16.5 4 4"],
  check: ["m5 13 4.5 4.5L19 7"],
  bestiary: ["M4 18v-5a8 8 0 0 1 16 0v5M9 12h.01M15 12h.01M8 18h8"],
  spells: ["m12 3 2.2 5.4L20 10l-4.4 3.6L16.8 20 12 16.9 7.2 20l1.2-6.4L4 10l5.8-1.6Z"],
  rules: ["M4 5h16v14H4zM8 5v14M4 9h4M4 13h4"],
  items: ["M6 3h12l2 5-8 13L4 8Z", "M4 8h16"],
  classes: ["M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"],
  dice: ["M12 2.5 21 7.5v9L12 21.5 3 16.5v-9Z", "M12 2.5v19M3 7.5l9 5 9-5"],
  swords: ["M4 4h4l11 11v5h-5L3 9V4Z", "m14 14 6 6M5 19l4-4"],
  flow: ["M6 4v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6", "M4 4h4M16 17h4M4 20h4"],
  plus: ["M12 5v14M5 12h14"],
  minus: ["M5 12h14"],
  trash: ["M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  undo: ["M4 9h11a5 5 0 0 1 0 10h-6", "M8 5 4 9l4 4"],
  pencil: ["M4 20h4L20 8l-4-4L4 16Z", "M14 6l4 4"],
} as const;

export function icon(name: keyof typeof ICONS, size = 16, strokeWidth = 1.5): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.flex = "none";
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * Renders prose with every dice expression turned into a clickable chip,
 * so "7 (1d10 + 2) piercing damage" becomes rollable in place.
 */
export function prose(text: string, onRoll: (expr: string) => void): HTMLElement {
  const p = el("p", { class: "prose" });
  let last = 0;
  DICE_RE.lastIndex = 0;

  for (let m = DICE_RE.exec(text); m; m = DICE_RE.exec(text)) {
    const expr = m[0].trim();
    if (m.index > last) p.append(text.slice(last, m.index));
    p.append(el("button", {
      class: "dice",
      title: `Roll ${expr}`,
      onclick: (e: Event) => { e.stopPropagation(); onRoll(expr); },
      text: expr,
    }));
    last = m.index + m[0].length;
  }
  if (last < text.length) p.append(text.slice(last));
  return p;
}

export function highlighted(text: string, range: [number, number] | null): (Node | string)[] {
  if (!range) return [text];
  const [start, end] = range;
  return [
    text.slice(0, start),
    el("span", { class: "mark", text: text.slice(start, end) }),
    text.slice(end),
  ];
}

/**
 * Body text as a sequence of blocks: paragraphs, and tables where the source
 * used pipe markdown. Dice stay clickable inside both.
 */
export function richText(text: string, onRoll: (expr: string) => void): DocumentFragment {
  const frag = document.createDocumentFragment();

  for (const block of parseBlocks(text)) {
    if (block.kind === "paragraph") {
      frag.append(prose(block.text, onRoll));
      continue;
    }

    const wrap = el("div", { class: "table-wrap" });
    if (block.caption) wrap.append(el("span", { class: "table-caption", text: block.caption }));

    const node = el("table", { class: "rule-table" });
    if (block.header.length) {
      node.append(el("thead", {}, [el("tr", {}, block.header.map((c) => el("th", { text: c })))]));
    }
    node.append(el("tbody", {}, block.rows.map((row) =>
      el("tr", {}, row.map((c) => el("td", {}, [prose(c, onRoll)])))
    )));

    wrap.append(node);
    frag.append(wrap);
  }

  return frag;
}
