// SRD source -> src/data/rules.json. Run at build time only — the output
// is generated and must not be hand-edited (edit data-src/ instead).
import { readFileSync, writeFileSync } from "node:fs";
import type { Rule } from "../src/types";

type SourceEntry = {
  id: string;
  title: string;
  category: string;
  text: string;
  related: string[];
};

const SOURCE_PATH = "data-src/srd-rules-source.json";
const OUTPUT_PATH = "src/data/rules.json";
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fail(message: string): never {
  console.error(`build-rules: ${message}`);
  process.exit(1);
}

const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8")) as SourceEntry[];

const seenIds = new Set<string>();
for (const entry of source) {
  if (!SLUG_RE.test(entry.id)) fail(`invalid id (must be a lowercase slug): "${entry.id}"`);
  if (seenIds.has(entry.id)) fail(`duplicate id: "${entry.id}"`);
  seenIds.add(entry.id);
  if (!entry.title.trim()) fail(`missing title for id "${entry.id}"`);
  if (!entry.category.trim()) fail(`missing category for id "${entry.id}"`);
  if (!entry.text.trim()) fail(`missing body text for id "${entry.id}"`);
}

for (const entry of source) {
  for (const relatedId of entry.related) {
    if (!seenIds.has(relatedId)) {
      fail(`"${entry.id}" has seeAlso reference to unknown id "${relatedId}"`);
    }
  }
}

const rules: Rule[] = source
  .map((entry) => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    body: entry.text.trim(),
    ...(entry.related.length ? { seeAlso: entry.related } : {}),
  }))
  .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

writeFileSync(OUTPUT_PATH, JSON.stringify(rules, null, 2) + "\n");
console.log(`build-rules: wrote ${rules.length} rules to ${OUTPUT_PATH}`);
