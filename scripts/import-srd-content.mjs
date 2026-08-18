#!/usr/bin/env node
// One-time import: transforms open SRD 5.1 data from the 5e-bits/5e-database
// project (https://github.com/5e-bits/5e-database, MIT-licensed structuring
// of the WotC SRD content, which we in turn attribute as SRD 5.1 CC-BY-4.0
// per our own README/footer) into our source-entry shape and writes
// data-src/srd-{spells,monsters,magic-items}-source.json.
//
// NOT part of the normal build — build-rules.ts consumes these generated
// files same as the hand-authored one. Re-run this only to refresh from a
// newer checkout of 5e-bits/5e-database. Usage:
//   node scripts/import-srd-content.mjs [path-to-5e-database-checkout]
import { readFileSync, writeFileSync } from "node:fs";

const repoPath = process.argv[2] ?? "/workspace/5e-bits/5e-database";
const dataDir = `${repoPath}/src/2014/en`;

function loadJson(file) {
  return JSON.parse(readFileSync(`${dataDir}/${file}`, "utf8"));
}

function truncate(text, max) {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function formatCR(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// ---------------------------------------------------------------- spells --
function transformSpells() {
  const spells = loadJson("5e-SRD-Spells.json");
  return spells.map((s) => {
    const levelSchool = s.level === 0 ? `${s.school.name} cantrip` : `Level ${s.level} ${s.school.name}`;
    const components = s.components.join(", ") + (s.material ? ` (${s.material})` : "");
    const duration = s.concentration ? `Concentration, ${s.duration}` : s.duration;
    const ritual = s.ritual ? " (ritual)" : "";

    const header = `${levelSchool}${ritual}. Casting time ${s.casting_time}. Range ${s.range}. Components ${components}. Duration ${duration}.`;
    const effect = truncate((s.desc ?? []).join(" "), 420);
    const higher = s.higher_level?.length ? ` At higher levels: ${truncate(s.higher_level.join(" "), 140)}` : "";

    const related = [];
    if (s.concentration) related.push("concentration");
    if (s.level > 0) related.push("spell-slots");
    else related.push("casting-time");

    return {
      id: s.index,
      title: s.name,
      category: "spells",
      text: `${header}\n${effect}${higher}`,
      related,
    };
  });
}

// -------------------------------------------------------------- monsters --
function transformMonsters() {
  const monsters = loadJson("5e-SRD-Monsters.json");
  return monsters.map((m) => {
    const ac = m.armor_class?.[0];
    const armorNames = ac?.armor?.map((a) => a.name).join(", ");
    const acText = ac ? `${ac.value}${armorNames ? ` (${armorNames})` : ""}` : "?";
    const speedEntries = Object.entries(m.speed ?? {}).filter(([, v]) => typeof v === "string");
    const speed = speedEntries.map(([k, v]) => `${k} ${v.replace(/\.$/, "")}`).join(", ");
    const hover = m.speed?.hover ? " (hover)" : "";
    const typeLine = `${m.size} ${m.type}${m.subtype ? ` (${m.subtype})` : ""}, ${m.alignment}`;
    const header = `${typeLine}. AC ${acText}, HP ${m.hit_points} (${m.hit_dice}), Speed ${speed}${hover}. CR ${formatCR(m.challenge_rating)} (${m.xp} XP).`;
    const abilities = `Str ${m.strength} Dex ${m.dexterity} Con ${m.constitution} Int ${m.intelligence} Wis ${m.wisdom} Cha ${m.charisma}.`;

    const traits = m.special_abilities ?? [];
    const traitLines = traits
      .slice(0, 2)
      .map((t) => `${t.name}: ${truncate(t.desc, 110)}`)
      .join(" ");
    const traitsExtra = traits.length > 2 ? ` (+${traits.length - 2} more traits)` : "";

    const actions = m.actions ?? [];
    const actionLines = actions
      .slice(0, 3)
      .map((a) => `${a.name}: ${truncate(a.desc, 120)}`)
      .join(" ");
    const actionsExtra = actions.length > 3 ? ` (+${actions.length - 3} more actions)` : "";

    const lines = [header, abilities];
    if (traitLines) lines.push(`Traits — ${traitLines}${traitsExtra}`);
    if (actionLines) lines.push(`Actions — ${actionLines}${actionsExtra}`);

    return {
      id: m.index,
      title: m.name,
      category: "bestiary",
      text: lines.join("\n"),
      related: [],
    };
  });
}

// ----------------------------------------------------------- magic items --
function transformMagicItems() {
  const items = loadJson("5e-SRD-Magic-Items.json");
  return items.map((mi) => {
    const [typeLine, ...rest] = mi.desc ?? [];
    const body = truncate(rest.join(" "), 420);
    const text = [typeLine, body].filter(Boolean).join("\n");

    const related = /attunement/i.test(mi.desc?.join(" ") ?? "") ? ["attunement"] : [];

    return {
      id: mi.index,
      title: mi.name,
      category: "magic items",
      text,
      related,
    };
  });
}

const spellEntries = transformSpells();
const monsterEntries = transformMonsters();
const itemEntries = transformMagicItems();

writeFileSync("data-src/srd-spells-source.json", JSON.stringify(spellEntries, null, 2) + "\n");
writeFileSync("data-src/srd-monsters-source.json", JSON.stringify(monsterEntries, null, 2) + "\n");
writeFileSync("data-src/srd-magic-items-source.json", JSON.stringify(itemEntries, null, 2) + "\n");

console.log(`spells: ${spellEntries.length}, monsters: ${monsterEntries.length}, magic items: ${itemEntries.length}`);
