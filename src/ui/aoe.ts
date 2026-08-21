import type { SpellShape } from "../spells";

/**
 * A small diagram of what a spell covers, drawn on a five-foot grid.
 *
 * The grid is the point: "20-foot radius" is a phrase, four squares is
 * something you can count onto a battle map mid-turn. Shapes are drawn to
 * scale against that grid wherever they fit, and the caster's position is
 * always marked, because where the shape starts is half of what a DM is
 * checking.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const SIZE = 132;
const SQUARE = 5; // feet per grid square

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/**
 * Pixels per foot, chosen so the shape fills the box.
 *
 * How far the shape actually spans depends on what `size` means for it: a
 * radius covers twice its own value across, while a cone's or a line's
 * length is the whole span. Treating them alike drew a 100-foot bolt as a
 * stick in the corner of an empty square.
 */
function spanOf(shape: SpellShape): number {
  switch (shape.kind) {
    case "sphere":
    case "radius":
    case "cylinder":
      return shape.size * 2;
    case "cone":
    case "line":
    case "cube":
    case "square":
      return Math.max(shape.size, shape.extent ?? 0);
    default:
      return SQUARE * 6;
  }
}

function scaleFor(shape: SpellShape): number {
  return (SIZE - 24) / Math.max(spanOf(shape), SQUARE * 2);
}

function grid(px: number): SVGGElement {
  const g = node("g", { class: "aoe-grid" });
  const step = px * SQUARE;
  if (step >= 3) {
    for (let x = (SIZE / 2) % step; x <= SIZE; x += step) {
      g.append(node("line", { x1: x, y1: 0, x2: x, y2: SIZE }));
    }
    for (let y = (SIZE / 2) % step; y <= SIZE; y += step) {
      g.append(node("line", { x1: 0, y1: y, x2: SIZE, y2: y }));
    }
  }
  return g;
}

/** The caster, or the point the effect is centred on. */
function origin(x: number, y: number): SVGGElement {
  const g = node("g", { class: "aoe-origin" });
  g.append(node("circle", { cx: x, cy: y, r: 3.2 }));
  return g;
}

function area(child: SVGElement): SVGElement {
  child.setAttribute("class", "aoe-area");
  return child;
}

export function aoeDiagram(shape: SpellShape): SVGSVGElement {
  const svg = node("svg", {
    class: "aoe",
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    width: SIZE,
    height: SIZE,
    role: "img",
    "aria-label": shape.label,
  });

  const px = scaleFor(shape);
  const mid = SIZE / 2;
  svg.append(grid(px));

  switch (shape.kind) {
    case "sphere":
    case "radius":
    case "cylinder": {
      const r = shape.size * px;
      svg.append(area(node("circle", { cx: mid, cy: mid, r })));
      // The radius is the number on the page, so it is the one drawn.
      svg.append(node("line", { class: "aoe-measure", x1: mid, y1: mid, x2: mid + r, y2: mid }));
      svg.append(origin(mid, mid));
      break;
    }

    case "cone": {
      // 5e cones are as wide as they are long at the far end.
      const len = shape.size * px;
      const half = len / 2;
      const x = mid - len / 2;
      svg.append(area(node("polygon", {
        points: `${x},${mid} ${x + len},${mid - half} ${x + len},${mid + half}`,
      })));
      svg.append(origin(x, mid));
      break;
    }

    case "line": {
      const len = shape.size * px;
      const wide = Math.max(4, (shape.extent ?? 5) * px);
      const x = mid - len / 2;
      svg.append(area(node("rect", { x, y: mid - wide / 2, width: len, height: wide })));
      svg.append(origin(x, mid));
      break;
    }

    case "cube":
    case "square": {
      const side = shape.size * px;
      svg.append(area(node("rect", { x: mid - side / 2, y: mid - side / 2, width: side, height: side })));
      svg.append(origin(mid, mid));
      break;
    }

    case "touch": {
      svg.append(area(node("circle", { cx: mid + 9, cy: mid, r: 7 })));
      svg.append(node("line", { class: "aoe-measure", x1: mid, y1: mid, x2: mid + 9, y2: mid }));
      svg.append(origin(mid - 9, mid));
      break;
    }

    case "self": {
      svg.append(area(node("circle", { cx: mid, cy: mid, r: 13 })));
      svg.append(origin(mid, mid));
      break;
    }

    case "target": {
      // Range is drawn as reach rather than to scale — 120 feet at this size
      // would be a dot at each end and nothing to read in between.
      const from = mid - 34;
      const to = mid + 34;
      svg.append(node("line", { class: "aoe-measure aoe-dashed", x1: from, y1: mid, x2: to - 8, y2: mid }));
      svg.append(area(node("circle", { cx: to, cy: mid, r: 6 })));
      svg.append(origin(from, mid));
      break;
    }
  }

  return svg;
}
