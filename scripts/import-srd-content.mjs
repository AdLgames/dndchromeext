#!/usr/bin/env node
// One-time import: transforms open SRD 5.1 data from the 5e-bits/5e-database
// project (https://github.com/5e-bits/5e-database, MIT-licensed structuring
// of the WotC SRD content, which we in turn attribute as SRD 5.1 CC-BY-4.0
// per our own README/footer) into our source-entry shape and writes
// data-src/srd-{spells,monsters,magic-items,classes}-source.json.
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

function formatCR(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

function sentenceCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Upstream indexes occasionally carry doubled/trailing hyphens. */
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function joinDesc(desc) {
  return (desc ?? []).join("\n").trim();
}

// ---------------------------------------------------------------- spells --
const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

function transformSpells() {
  return loadJson("5e-SRD-Spells.json").map((s) => {
    const components = s.components.join(", ");
    const subtitleBits = [
      s.level === 0 ? `${s.school.name} cantrip` : `${ORDINAL[s.level]}-level ${s.school.name.toLowerCase()}`,
    ];
    if (s.concentration) subtitleBits.push("concentration");
    if (s.ritual) subtitleBits.push("ritual");

    return {
      id: slug(s.index),
      title: s.name,
      group: "spells",
      category: s.school.name.toLowerCase(),
      subtitle: subtitleBits.join(" · "),
      badge: s.level === 0 ? "Cantrip" : `Lvl ${s.level}`,
      text: joinDesc(s.desc),
      related: s.concentration ? ["concentration"] : [],
      spell: {
        level: s.level,
        school: s.school.name,
        castingTime: s.casting_time,
        range: s.range,
        components,
        material: s.material || undefined,
        duration: s.duration,
        concentration: !!s.concentration,
        ritual: !!s.ritual,
        classes: (s.classes ?? []).map((c) => c.name),
        higherLevel: s.higher_level?.length ? joinDesc(s.higher_level) : undefined,
      },
    };
  });
}

// -------------------------------------------------------------- monsters --
const ATTACK_RE = /^((?:Melee|Ranged|Melee or Ranged)\s+(?:Weapon|Spell)\s+Attack):\s*([+-]\d+)\s+to hit,\s*/i;
const SAVE_DC_RE = /DC\s+(\d+)\s+(\w+)\s+saving throw/i;
const RECHARGE_RE = /^(.*?)\s*\((Recharge[^)]*|\d+\/[A-Za-z]+)\)\s*$/;

function parseAction(action) {
  let name = action.name;
  let label;
  let value;
  let desc = action.desc ?? "";

  const recharge = RECHARGE_RE.exec(name);
  if (recharge) {
    name = recharge[1];
    label = recharge[2];
  }

  const attack = ATTACK_RE.exec(desc);
  if (attack) {
    label = attack[1].replace(/\s+/g, " ");
    value = attack[2];
    desc = sentenceCase(desc.slice(attack[0].length));
  } else {
    const save = SAVE_DC_RE.exec(desc);
    if (save) value = `DC ${save[1]}`;
  }

  return { name, ...(label ? { label } : {}), ...(value ? { value } : {}), desc: desc.trim() };
}

function transformMonsters() {
  return loadJson("5e-SRD-Monsters.json").map((m) => {
    const ac = m.armor_class?.[0];
    const acNote = ac?.armor?.map((a) => a.name).join(", ") || (ac?.type !== "natural" ? ac?.type : undefined);

    const speeds = Object.entries(m.speed ?? {})
      .filter(([, v]) => typeof v === "string")
      .map(([label, value]) => ({ label, value: value.replace(/\.$/, "") }));
    if (m.speed?.hover) speeds.push({ label: "hover", value: "yes" });

    const profs = m.proficiencies ?? [];
    const pick = (prefix) =>
      profs
        .filter((p) => p.proficiency.index.startsWith(prefix))
        .map((p) => `${p.proficiency.name.replace(/^(Saving Throw|Skill):\s*/, "")} ${p.value >= 0 ? "+" : ""}${p.value}`)
        .join(", ");

    const senses = Object.entries(m.senses ?? {})
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
      .join(", ");

    const list = (arr) => (arr?.length ? arr.join(", ") : undefined);

    const traits = (m.special_abilities ?? []).map((t) => ({ name: t.name, desc: t.desc }));
    const actions = (m.actions ?? []).map(parseAction);
    const reactions = (m.reactions ?? []).map((r) => ({ name: r.name, desc: r.desc }));
    const legendary = (m.legendary_actions ?? []).map((l) => ({ name: l.name, desc: l.desc }));

    // Flattened plain text, used for body-text search and as a fallback.
    const searchText = [
      `${m.size} ${m.type}${m.subtype ? ` (${m.subtype})` : ""}, ${m.alignment}.`,
      ...traits.map((t) => `${t.name}. ${t.desc}`),
      ...actions.map((a) => `${a.name}. ${a.desc}`),
      ...reactions.map((r) => `${r.name}. ${r.desc}`),
      ...legendary.map((l) => `${l.name}. ${l.desc}`),
    ].join("\n");

    return {
      id: slug(m.index),
      title: m.name,
      group: "bestiary",
      category: m.type,
      subtitle: `${m.size} ${m.type} · ${m.alignment}`,
      badge: `CR ${formatCR(m.challenge_rating)}`,
      text: searchText,
      related: [],
      monster: {
        ac: ac?.value ?? 10,
        acNote: acNote || undefined,
        hp: m.hit_points,
        hitDice: m.hit_dice,
        cr: formatCR(m.challenge_rating),
        xp: m.xp,
        prof: m.proficiency_bonus,
        speeds,
        abilities: {
          str: m.strength, dex: m.dexterity, con: m.constitution,
          int: m.intelligence, wis: m.wisdom, cha: m.charisma,
        },
        saves: pick("saving-throw-") || undefined,
        skills: pick("skill-") || undefined,
        vulnerabilities: list(m.damage_vulnerabilities),
        resistances: list(m.damage_resistances),
        immunities: list(m.damage_immunities),
        conditionImmunities: list((m.condition_immunities ?? []).map((c) => c.name)),
        senses: senses || undefined,
        languages: m.languages || undefined,
        traits, actions, reactions, legendary,
      },
    };
  });
}

// ----------------------------------------------------------- magic items --
function transformMagicItems() {
  return loadJson("5e-SRD-Magic-Items.json").map((mi) => {
    const [typeLine, ...rest] = mi.desc ?? [];
    const attunement = /requires attunement/i.test(typeLine ?? "");
    const cleaned = (typeLine ?? "").replace(/\s*\(requires attunement[^)]*\)/i, "");
    const [kind, ...rarityBits] = cleaned.split(",");
    const rarity = rarityBits.join(",").trim();

    return {
      id: slug(mi.index),
      title: mi.name,
      group: "items",
      category: mi.equipment_category?.name?.toLowerCase() ?? "wondrous item",
      subtitle: cleaned.trim(),
      badge: rarity ? sentenceCase(rarity) : undefined,
      text: joinDesc(rest),
      related: attunement ? ["attunement"] : [],
      item: { kind: (kind ?? "").trim(), rarity, attunement },
    };
  });
}

// -------------------------------------------------------------- classes ---
function transformClasses() {
  const classes = loadJson("5e-SRD-Classes.json");
  const features = loadJson("5e-SRD-Features.json");
  const subclasses = loadJson("5e-SRD-Subclasses.json");
  const subclassByIndex = new Map(subclasses.map((s) => [s.index, s]));

  const classEntries = classes.map((c) => {
    const saves = (c.saving_throws ?? []).map((s) => s.name).join(", ");
    const armorWeapons = (c.proficiencies ?? []).map((p) => p.name).join(", ");
    return {
      id: slug(`class-${c.index}`),
      title: c.name,
      group: "classes",
      category: "class",
      subtitle: `Hit die d${c.hit_die} · Saves ${saves}`,
      badge: `d${c.hit_die}`,
      text: `Hit die: d${c.hit_die}.\nSaving throws: ${saves}.\nProficiencies: ${armorWeapons}.`,
      related: [],
      feature: { className: c.name },
    };
  });

  const featureEntries = features.map((f) => {
    const sub = f.subclass ? subclassByIndex.get(f.subclass.index) : undefined;
    const subName = sub?.name ?? f.subclass?.name;
    return {
      id: slug(`feat-${f.index}`),
      title: f.name,
      group: "classes",
      category: f.class.name.toLowerCase(),
      subtitle: [`${f.class.name}${subName ? ` (${subName})` : ""}`, `level ${f.level}`].join(" · "),
      badge: `Lv ${f.level}`,
      text: joinDesc(f.desc),
      related: [],
      feature: { className: f.class.name, level: f.level, subclass: subName },
    };
  });

  return [...classEntries, ...featureEntries];
}

const out = {
  "data-src/srd-spells-source.json": transformSpells(),
  "data-src/srd-monsters-source.json": transformMonsters(),
  "data-src/srd-magic-items-source.json": transformMagicItems(),
  "data-src/srd-classes-source.json": transformClasses(),
};

for (const [path, entries] of Object.entries(out)) {
  writeFileSync(path, JSON.stringify(entries, null, 2) + "\n");
  console.log(`${path}: ${entries.length}`);
}
