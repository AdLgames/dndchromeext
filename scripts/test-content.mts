/**
 * Checks the export/import path end to end against a fake chrome.storage:
 * that a bundle round-trips, that loading the same file twice updates rather
 * than duplicates, that a v1 party file still loads, and that hostile JSON is
 * coerced rather than trusted. Run with `npm test`.
 */
const store: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (k: string) => ({ [k]: store[k] }),
      set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
    },
    onChanged: { addListener: () => {} },
  },
};

const { exportContent, parseContentFile, importContent } = await import("../src/backup.js");
const { getHomebrew, newHomebrew, saveHomebrew, sanitizeRule } = await import("../src/homebrew.js");
const { getParty, newCharacter, saveParty } = await import("../src/party.js");
const { getPortraits } = await import("../src/portraits.js");

const assert = (ok: unknown, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) process.exitCode = 1;
};

// --- seed
const hound = newHomebrew("bestiary");
hound.title = "Rustmaw Hound";
hound.monster!.hp = 33;
hound.monster!.actions = [{ name: "Bite", value: "+4", desc: "Hit: 9 (2d6 + 2) piercing damage." }];
const hero = newCharacter("Brannor");
await saveHomebrew([hound]);
await saveParty([hero]);
store["rulesOverlay:portraits"] = {
  [hound.id]: "data:image/jpeg;base64,AAAA",
  [`character:${hero.id}`]: "data:image/jpeg;base64,BBBB",
  "monster-goblin": "data:image/jpeg;base64,CCCC", // a bundled entry: should not travel
};

// --- export
const text = await exportContent();
const file = JSON.parse(text);
assert(file.format === "rules-overlay-content" && file.version === 2, "export writes the current format");
assert(Object.keys(file.portraits).length === 2, "export carries only its own pictures");
assert(!("monster-goblin" in file.portraits), "export leaves bundled entries' pictures behind");

// --- parse
const bundle = parseContentFile(text);
assert(bundle.homebrew.length === 1 && bundle.homebrew[0].title === "Rustmaw Hound", "parse restores the entry");
assert(bundle.homebrew[0].monster?.actions[0].desc.includes("2d6 + 2"), "parse keeps the damage line");
assert(bundle.characters[0].name === "Brannor", "parse restores the character");

// --- import merges rather than replaces, and updates in place by id
store["rulesOverlay:homebrew"] = [];
store["rulesOverlay:party"] = [];
await saveHomebrew([newHomebrew("spells")]);
await saveParty([newCharacter("Someone already here")]);
await importContent(bundle);
assert((await getHomebrew()).length === 2, "import adds alongside what is already here");
await importContent(parseContentFile(text));
assert((await getHomebrew()).length === 2, "importing the same file twice updates rather than duplicates");
assert((await getParty()).length === 2, "the imported character joins the one already here");
assert((await getParty()).filter((c) => c.name === "Brannor").length === 1,
  "re-importing the same file does not duplicate the character");
assert((await getParty()).some((c) => c.id === hero.id), "a character keeps their id, so their picture still points at them");
assert(Object.keys(await getPortraits()).length >= 2, "pictures come across");

// --- a v1 party file still loads
const legacy = JSON.stringify({
  format: "rules-overlay-party", version: 1,
  characters: [{ name: "Sella", level: 5, abilities: { dex: 18 } }],
});
const old = parseContentFile(legacy);
assert(old.characters[0].name === "Sella" && old.characters[0].abilities.dex === 18, "v1 party files still import");

// --- hostile input
const nasty = sanitizeRule({
  id: "monster-goblin",                 // tries to shadow a bundled slug
  group: "nonsense",
  title: 42,
  source: "srd",                        // tries to pass itself off as SRD
  body: "x".repeat(50000),
  monster: { ac: "twelve", actions: "not an array" },
  spell: { level: 99 },
  onclick: "alert(1)",
});
assert(nasty.id.startsWith("hb-"), "an imported id cannot shadow a bundled slug");
assert(nasty.group === "rules", "an unknown group falls back");
assert(nasty.title === "Untitled", "a non-string title is replaced");
assert(nasty.source === "homebrew", "an entry cannot claim to be SRD");
assert(nasty.body.length <= 8000, "prose is capped");
assert(nasty.monster === undefined && nasty.spell === undefined, "sub-blocks that do not match the group are dropped");
assert(!("onclick" in nasty), "unknown keys do not survive");

const badPortraits = parseContentFile(JSON.stringify({
  format: "rules-overlay-content", version: 2, characters: [], homebrew: [],
  portraits: { a: "https://example.com/x.png", b: "javascript:alert(1)", c: "data:image/jpeg;base64,ZZZZ" },
}));
assert(Object.keys(badPortraits.portraits).join() === "c", "only data-URL pictures are kept");
