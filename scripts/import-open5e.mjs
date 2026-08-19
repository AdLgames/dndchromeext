#!/usr/bin/env node
// Imports the openly licensed non-SRD sources bundled by the Open5e project
// (https://github.com/open5e/open5e-api) into our source-entry shape.
//
// Only sources whose licence we can honour by shipping an attribution notice
// are pulled in:
//   * a5e       — Level Up: Advanced 5e SRD, CC-BY-4.0 (same terms as SRD 5.1)
//   * blackflag — Black Flag SRD (Kobold Press), ORC License
//
// Open5e also carries a lot of OGL-1.0a material (Tome of Beasts, Deep Magic,
// Creature Codex …). Those are deliberately NOT imported: redistributing them
// requires shipping the OGL 1.0a text and an accurate Section 15 chain, which
// is a legal step to take on purpose rather than a side effect of an import
// script. Add them only with that paperwork in place.
//
// Usage: node scripts/import-open5e.mjs [path-to-open5e-api-checkout]
import { readFileSync, writeFileSync } from "node:fs";

const repo = process.argv[2] ?? "/workspace/open5e/open5e-api";
const dataDir = `${repo}/data/v1`;

const ALLOWED = new Set(["a5e", "blackflag"]);

function load(source, file) {
  const raw = JSON.parse(readFileSync(`${dataDir}/${source}/${file}`, "utf8"));
  return raw.map((row) => row.fields ?? row);
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function clean(text) {
  // Open5e stores emphasis as markdown underscores; drop them for plain text.
  return (text ?? "").replace(/_([^_]+)_/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
}

function title(text) {
  const value = String(text ?? "");
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : "";
}

function crLabel(cr) {
  const value = Number(cr);
  if (value === 0.125) return "1/8";
  if (value === 0.25) return "1/4";
  if (value === 0.5) return "1/2";
  return String(value);
}

const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

// --------------------------------------------------------------- a5e ----
function a5eSpells() {
  return load("a5e", "Spell.json").map((s) => {
    const level = Number(s.spell_level) || 0;
    const components = [
      s.requires_verbal_components && "V",
      s.requires_somatic_components && "S",
      s.requires_material_components && "M",
    ].filter(Boolean).join(", ");

    const subtitle = [
      level === 0 ? `${s.school} cantrip` : `${ORDINAL[level] ?? level}-level ${String(s.school).toLowerCase()}`,
      s.requires_concentration ? "concentration" : null,
      s.can_be_cast_as_ritual ? "ritual" : null,
    ].filter(Boolean).join(" · ");

    return {
      id: slug(`a5e-${s.name}`),
      title: s.name,
      group: "spells",
      source: "a5e",
      category: String(s.school ?? "").toLowerCase() || "spell",
      subtitle,
      badge: level === 0 ? "Cantrip" : `Lvl ${level}`,
      text: clean(s.desc),
      related: s.requires_concentration ? ["concentration"] : [],
      spell: {
        level,
        school: s.school ?? "",
        castingTime: s.casting_time ?? "",
        range: s.range ?? "",
        components,
        material: s.material || undefined,
        duration: s.duration ?? "",
        concentration: !!s.requires_concentration,
        ritual: !!s.can_be_cast_as_ritual,
        classes: String(s.dnd_class ?? "").split(",").map((c) => c.trim()).filter(Boolean),
        higherLevel: clean(s.higher_level) || undefined,
      },
    };
  });
}

function a5eItems() {
  return load("a5e", "MagicItem.json").map((i) => ({
    id: slug(`a5e-${i.name}`),
    title: i.name,
    group: "items",
    source: "a5e",
    category: String(i.type ?? "wondrous item").toLowerCase(),
    subtitle: [i.type, i.rarity].filter(Boolean).join(", "),
    badge: i.rarity ? i.rarity[0].toUpperCase() + i.rarity.slice(1) : undefined,
    text: clean(i.desc),
    related: i.requires_attunement ? ["attunement"] : [],
    item: {
      kind: i.type ?? "",
      rarity: i.rarity ?? "",
      attunement: !!i.requires_attunement && i.requires_attunement !== "",
    },
  }));
}

function a5eFeats() {
  return load("a5e", "Feat.json").map((f) => ({
    id: slug(`a5e-feat-${f.name}`),
    title: f.name,
    group: "classes",
    source: "a5e",
    category: "feat",
    subtitle: f.prerequisite ? `Feat · ${clean(f.prerequisite)}` : "Feat",
    badge: "Feat",
    text: clean(f.desc),
    related: [],
    feature: { className: "Feat" },
  }));
}

function a5eBackgrounds() {
  return load("a5e", "Background.json").map((b) => ({
    id: slug(`a5e-background-${b.name}`),
    title: b.name,
    group: "classes",
    source: "a5e",
    category: "background",
    subtitle: "Background",
    badge: "Bg",
    text: clean(b.desc),
    related: [],
    feature: { className: "Background" },
  }));
}

// --------------------------------------------------------- black flag ----
const ATTACK_RE = /^((?:Melee|Ranged|Melee or Ranged)\s+(?:Weapon|Spell)\s+Attack):\s*([+-]\d+)\s+to hit,\s*/i;
const SAVE_DC_RE = /DC\s+(\d+)\s+(\w+)\s+save/i;
const RECHARGE_RE = /^(.*?)\s*\((Recharge[^)]*|\d+\/[A-Za-z]+)\)\s*$/;

function parseJsonField(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAction(action) {
  let name = action.name ?? "";
  let label;
  let value;
  let desc = clean(action.desc ?? "");

  const recharge = RECHARGE_RE.exec(name);
  if (recharge) { name = recharge[1]; label = recharge[2]; }

  const attack = ATTACK_RE.exec(desc);
  if (attack) {
    label = attack[1].replace(/\s+/g, " ");
    value = attack[2];
    desc = desc.slice(attack[0].length);
    desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  } else {
    const save = SAVE_DC_RE.exec(desc);
    if (save) value = `DC ${save[1]}`;
  }

  return { name, ...(label ? { label } : {}), ...(value ? { value } : {}), desc: desc.trim() };
}

function blackFlagMonsters() {
  return load("blackflag", "Monster.json").map((m) => {
    const speeds = Object.entries(parseJsonField(m.speed_json) ?? {}).length
      ? []
      : [];
    let speedObj = {};
    try { speedObj = m.speed_json ? JSON.parse(m.speed_json) : {}; } catch { speedObj = {}; }
    const speedList = Object.entries(speedObj)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .map(([label, v]) => ({ label, value: `${v} ft` }));

    const traits = parseJsonField(m.special_abilities_json).map((t) => ({
      name: t.name ?? "", desc: clean(t.desc ?? ""),
    }));
    const actions = parseJsonField(m.actions_json).map(parseAction);
    const reactions = parseJsonField(m.reactions_json).map((r) => ({
      name: r.name ?? "", desc: clean(r.desc ?? ""),
    }));
    const legendary = parseJsonField(m.legendary_actions_json).map((l) => ({
      name: l.name ?? "", desc: clean(l.desc ?? ""),
    }));

    const skills = parseJsonField(m.skills_json);
    const skillText = Array.isArray(skills)
      ? skills.map((s) => (typeof s === "string" ? s : `${s.name} ${s.value >= 0 ? "+" : ""}${s.value}`)).join(", ")
      : Object.entries(skills ?? {}).map(([k, v]) => `${k} +${v}`).join(", ");

    const saveBonuses = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
      .map((a) => (m[`${a}_save`] ? `${a.slice(0, 3).toUpperCase()} ${m[`${a}_save`] >= 0 ? "+" : ""}${m[`${a}_save`]}` : null))
      .filter(Boolean)
      .join(", ");

    const searchText = [
      `${m.size} ${m.type}${m.subtype ? ` (${m.subtype})` : ""}${m.alignment ? `, ${m.alignment}` : ""}.`,
      clean(m.desc ?? ""),
      ...traits.map((t) => `${t.name}. ${t.desc}`),
      ...actions.map((a) => `${a.name}. ${a.desc}`),
    ].filter(Boolean).join("\n");

    return {
      id: slug(`bf-${m.name}`),
      title: m.name,
      group: "bestiary",
      source: "blackflag",
      category: String(m.type ?? "creature").toLowerCase(),
      // Upstream stores these as "medium Beast"; match the SRD's casing.
      subtitle: [
        `${title(m.size)} ${String(m.type ?? "").toLowerCase()}`.trim(),
        m.alignment,
      ].filter(Boolean).join(" · "),
      badge: `CR ${crLabel(m.cr ?? m.challenge_rating ?? 0)}`,
      text: searchText,
      related: [],
      monster: {
        ac: Number(m.armor_class) || 10,
        acNote: m.armor_desc || undefined,
        hp: Number(m.hit_points) || 1,
        hitDice: m.hit_dice || undefined,
        cr: crLabel(m.cr ?? m.challenge_rating ?? 0),
        xp: 0,
        prof: 2,
        speeds: speedList.length ? speedList : speeds,
        abilities: {
          str: Number(m.strength) || 10, dex: Number(m.dexterity) || 10,
          con: Number(m.constitution) || 10, int: Number(m.intelligence) || 10,
          wis: Number(m.wisdom) || 10, cha: Number(m.charisma) || 10,
        },
        saves: saveBonuses || undefined,
        skills: skillText || undefined,
        vulnerabilities: m.damage_vulnerabilities || undefined,
        resistances: m.damage_resistances || undefined,
        immunities: m.damage_immunities || undefined,
        conditionImmunities: m.condition_immunities || undefined,
        senses: m.senses || undefined,
        languages: m.languages || undefined,
        traits, actions, reactions, legendary,
      },
    };
  });
}

// ------------------------------------------------------------ sources ----
function sourceRecords() {
  return [...ALLOWED].map((slugName) => {
    const doc = load(slugName, "Document.json")[0];
    return {
      id: slugName,
      name: doc.title,
      organization: doc.organization,
      license: doc.license,
      url: doc.url,
      attribution: doc.copyright,
    };
  });
}

const entries = [
  ...a5eSpells(), ...a5eItems(), ...a5eFeats(), ...a5eBackgrounds(),
  ...blackFlagMonsters(),
  // A handful of upstream rows carry an empty description; an entry with no
  // body is not worth a search hit.
].filter((entry) => entry.text.trim().length > 0);

writeFileSync("data-src/open5e-source.json", JSON.stringify(entries, null, 2) + "\n");
writeFileSync("data-src/sources.json", JSON.stringify(sourceRecords(), null, 2) + "\n");

const byGroup = entries.reduce((acc, e) => ({ ...acc, [e.group]: (acc[e.group] ?? 0) + 1 }), {});
console.log(`open5e: wrote ${entries.length} entries`, byGroup);
