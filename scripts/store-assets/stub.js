// Screenshot harness only — never shipped in the extension.
// Stands in for the chrome APIs and seeds a small demo party, a couple of
// homebrew entries and an encounter, so the store screenshots have something
// in them. See store/SCREENSHOTS.md.
// Minimal chrome API stub so extension pages render outside the browser.
const store = {};
globalThis.chrome = {
  runtime: { getURL: (p) => p, sendMessage: () => {}, onMessage: { addListener: () => {} } },
  storage: {
    local: {
      get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: async (o) => { Object.assign(store, o); for (const [key, newValue] of Object.entries(o)) listeners.forEach((fn) => fn({ [key]: { newValue } }, "local")); },
    },
    onChanged: { addListener: (fn) => listeners.push(fn) },
  },
  commands: { getAll: async () => [] },
  tabs: { query: async () => [], create: () => {} },
  downloads: { download: async () => {} },
};
const listeners = [];
store["rulesOverlay:party"] = [{
  id: "c1", name: "Brannor", className: "Paladin", level: 5, ac: 18, hp: 44, maxHp: 44, speed: 30,
  abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 16 },
  spells: [{ name: "Bless", ruleId: "spell-bless" }], actions: [], items: [], notes: "",
}];
store["rulesOverlay:homebrew"] = [{
  id: "hb-rustmaw", title: "Rustmaw Hound", group: "bestiary", source: "homebrew",
  category: "monstrosity", body: "A scavenger of ruined forges, its jaws corrode iron on contact.",
  keywords: ["rust", "forge"],
  monster: {
    ac: 14, hp: 33, hitDice: "6d8 + 6", cr: "2", xp: 450, prof: 2,
    speeds: [{ label: "walk", value: "40 ft" }],
    abilities: { str: 15, dex: 14, con: 13, int: 3, wis: 12, cha: 6 },
    senses: "darkvision 60 ft", languages: "—",
    traits: [{ name: "Iron Sense", desc: "Smells worked metal within 60 feet." }],
    actions: [{ name: "Corroding Bite", label: "Melee Weapon Attack", value: "+4",
      desc: "Reach 5 ft., one target. Hit: 9 (2d6 + 2) piercing damage, and a metal weapon that hits it corrodes." }],
    reactions: [], legendary: [],
  },
}, {
  id: "hb-emberstep", title: "Emberstep", group: "spells", source: "homebrew", category: "conjuration",
  body: "You step through a cinder and out of another within 30 feet, leaving a scorch mark behind. 2d6 fire damage to anything in the space you leave.",
  spell: { level: 2, school: "conjuration", castingTime: "1 bonus action", range: "Self",
    components: "V, S", duration: "Instantaneous", concentration: false, ritual: false,
    classes: ["Sorcerer", "Warlock"] },
}];

const fighter = (over) => Object.assign({
  initiative: 12, ac: 15, hp: 20, maxHp: 20, tempHp: 0, speed: 30, movementUsed: 0,
  conditions: [], concentrating: false, concentrationNote: "", reactionUsed: false,
  deathSaves: { successes: 0, failures: 0 }, isPlayer: false, actions: [],
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saveBonuses: {}, profBonus: 2, actionUsed: false, bonusUsed: false,
}, over);
store["rulesOverlay:encounter"] = {
  round: 2, turn: 0, started: true, dmOverride: false,
  combatants: [
    fighter({ id: "f1", name: "Brannor", characterId: "c1", isPlayer: true, initiative: 18, ac: 18, hp: 31, maxHp: 44, level: 5 }),
    fighter({ id: "f2", name: "Rustmaw Hound", ruleId: "hb-rustmaw", initiative: 15, ac: 14, hp: 21, maxHp: 33 }),
    fighter({ id: "f3", name: "Goblin 2", ruleId: "monster-goblin", initiative: 12, ac: 15, hp: 0, maxHp: 7 }),
    fighter({ id: "f4", name: "Sella", characterId: "c2", isPlayer: true, initiative: 9, ac: 15, hp: 0, maxHp: 33, level: 5,
      conditions: ["prone"], deathSaves: { successes: 1, failures: 3 } }),
  ],
  order: ["f1", "f2", "f3", "f4"], log: [],
};

if (new URLSearchParams(location.search).get("dark")) store["rulesOverlay:settings"] = { appearance: "dark" };
