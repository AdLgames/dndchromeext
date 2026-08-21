/**
 * Rasterises the icon SVGs in icons/ to the PNGs the manifest declares.
 *
 * Each size is drawn from its own SVG rather than downscaled from one
 * master: stroke weights are chosen per size, and the 16px die drops its
 * inner triangle, which fills in solid at that scale.
 *
 * Chrome draws them, but through a canvas rather than a screenshot —
 * headless clamps window dimensions, so a 16px screenshot is not something
 * it will produce, while toDataURL gives the exact pixels asked for.
 *
 *   node scripts/rasterise-icons.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ICONS = [
  { size: 16, svg: "icons/icon-1b-16.svg", out: "icons/icon16.png" },
  { size: 48, svg: "icons/icon-1b-48.svg", out: "icons/icon48.png" },
  { size: 128, svg: "icons/icon-1b.svg", out: "icons/icon128.png" },
];

const work = mkdtempSync(join(tmpdir(), "icons-"));
const page = join(work, "draw.html");

const jobs = ICONS.map(({ size, svg }) => ({
  size,
  data: `data:image/svg+xml;base64,${readFileSync(svg).toString("base64")}`,
}));

writeFileSync(page, `<!doctype html><meta charset="utf-8"><body><div id="out"></div>
<script>
const jobs = ${JSON.stringify(jobs)};
Promise.all(jobs.map(({ size, data }) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    resolve(canvas.toDataURL("image/png").split(",")[1]);
  };
  img.src = data;
}))).then((pngs) => {
  document.getElementById("out").textContent = "BEGIN" + JSON.stringify(pngs) + "END";
});
</script>`);

const dom = execFileSync(CHROME, [
  "--headless", "--disable-gpu", "--no-sandbox",
  "--virtual-time-budget=8000", "--dump-dom", `file://${page}`,
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const payload = dom.slice(dom.indexOf("BEGIN") + 5, dom.indexOf("END"));
if (!payload) throw new Error("Chrome produced no image data");

const pngs = JSON.parse(payload);
ICONS.forEach(({ size, out }, i) => {
  const buf = Buffer.from(pngs[i], "base64");
  writeFileSync(out, buf);
  console.log(`${out}  ${size}x${size}  ${buf.length} bytes`);
});

rmSync(work, { recursive: true, force: true });
