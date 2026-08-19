import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const buildOptions = {
  entryPoints: [
    { in: "src/background.ts", out: "background" },
    { in: "src/content/mount.ts", out: "content" },
    { in: "src/options/options.ts", out: "options" },
    { in: "src/sidepanel/sidepanel.ts", out: "sidepanel" },
  ],
  bundle: true,
  outdir,
  format: "iife",
  target: "chrome114",
  loader: { ".css": "text" },
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
};

function copyStatic() {
  cpSync("manifest.json", `${outdir}/manifest.json`);
  cpSync("icons", `${outdir}/icons`, { recursive: true });
  cpSync("src/options/options.html", `${outdir}/options.html`);
  cpSync("src/sidepanel/sidepanel.html", `${outdir}/sidepanel.html`);
  cpSync("src/ui/theme.css", `${outdir}/theme.css`);
  cpSync("src/ui/panel.css", `${outdir}/panel.css`);
  // Data ships as fetchable resources rather than inside the bundles: the
  // content script is injected into every page, so keeping ~2MB of SRD text
  // out of it matters.
  mkdirSync(`${outdir}/data`, { recursive: true });
  cpSync("src/data/rules.json", `${outdir}/data/rules.json`);
  cpSync("src/data/aliases.json", `${outdir}/data/aliases.json`);
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  copyStatic();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  copyStatic();
  console.log("Build complete: dist/");
}
