/**
 * Checks the export/import path end to end against a fake chrome.storage:
 * that a bundle round-trips, that loading the same file twice updates rather
 * than duplicates, that a v1 party file still loads, and that hostile JSON is
 * coerced rather than trusted. Run with `npm test`.
 */
import type { Rule } from "../src/types.js";

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
assert(Object.keys(file.portraits).length === 3, "export carries every uploaded picture");
assert("monster-goblin" in file.portraits,
  "a picture put on a published entry is still the user's, and travels with the file");

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
assert(Object.keys(await getPortraits()).length >= 3, "pictures come across");

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

// --- death: a monster dies at 0, a player is only dying until three saves fail
const { applyDamage, canAct, isDead } = await import("../src/combat.js");
const body = (over: Record<string, unknown>) => ({
  id: "x", name: "X", initiative: 10, ac: 12, hp: 10, maxHp: 10, tempHp: 0, speed: 30,
  movementUsed: 0, conditions: [] as string[], concentrating: false, concentrationNote: "",
  reactionUsed: false, deathSaves: { successes: 0, failures: 0 }, isPlayer: false,
  actions: [], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saveBonuses: {}, profBonus: 2, actionUsed: false, bonusUsed: false, ...over,
}) as Parameters<typeof applyDamage>[0];

const felledBeast = applyDamage(body({}), 30);
assert(felledBeast.hp === 0 && isDead(felledBeast), "a monster at 0 HP is dead");
assert(!felledBeast.conditions.includes("unconscious"), "a dead monster is not labelled unconscious");
assert(!canAct(felledBeast), "a dead monster cannot act");

const felledHero = applyDamage(body({ isPlayer: true }), 30);
assert(felledHero.hp === 0 && !isDead(felledHero), "a player at 0 HP is dying, not dead");
assert(felledHero.conditions.includes("unconscious") && felledHero.conditions.includes("prone"),
  "a downed player is unconscious and prone");
assert(isDead(body({ isPlayer: true, hp: 0, deathSaves: { successes: 0, failures: 3 } })),
  "three failed death saves is death");
assert(!canAct(body({ isPlayer: true, hp: 5, deathSaves: { successes: 0, failures: 3 } })),
  "death sticks even if hit points come back without clearing the tally");

// --- duplicates are numbered from one, and renames are respected
const { nameForCopy } = await import("../src/combat.js");
const beast = (id: string, name: string) => body({ id, name, ruleId: "monster-badger" });

assert(nameForCopy([], "monster-badger", "Badger").name === "Badger",
  "the first of a kind is unnumbered");

const second = nameForCopy([beast("a", "Badger")], "monster-badger", "Badger");
assert(second.name === "Badger 2", "the second copy is numbered 2");
assert(second.renameFirst?.name === "Badger 1",
  "adding a second retroactively numbers the first");

const third = nameForCopy(
  [beast("a", "Badger 1"), beast("b", "Badger 2")], "monster-badger", "Badger");
assert(third.name === "Badger 3", "the third copy continues the run");
assert(!third.renameFirst, "nothing is renamed once the run is already numbered");

const afterRename = nameForCopy(
  [beast("a", "Alpha Badger"), beast("b", "Badger 2")], "monster-badger", "Badger");
assert(afterRename.name === "Badger 3" && !afterRename.renameFirst,
  "a name the DM chose is never overwritten");

assert(nameForCopy([beast("a", "Badger (CR 2)")], "monster-badger", "Badger (CR 2)").name
  === "Badger (CR 2) 2", "a scaled name with regex characters still numbers cleanly");

// --- someone joining a running fight takes their place in the order
const { insertIntoOrder } = await import("../src/combat.js");
const fight = (over: Record<string, unknown> = {}) => ({
  round: 1, turn: 1, started: true, dmOverride: false, log: [],
  combatants: [
    body({ id: "a", name: "A", initiative: 20 }),
    body({ id: "b", name: "B", initiative: 15 }),
    body({ id: "c", name: "C", initiative: 5 }),
  ],
  order: ["a", "b", "c"],
  ...over,
}) as Parameters<typeof insertIntoOrder>[0];

const middle = insertIntoOrder(fight(), body({ id: "n", name: "N", initiative: 10 }));
assert(middle.order.join() === "a,b,n,c", "a latecomer slots in by initiative");
assert(middle.turn === 1, "someone joining below the pointer leaves the active turn alone");

const top = insertIntoOrder(fight(), body({ id: "n", name: "N", initiative: 25 }));
assert(top.order.join() === "n,a,b,c", "the highest roll goes first in the order");
assert(top.turn === 2, "joining above the pointer shifts it, so the same combatant stays active");

const last = insertIntoOrder(fight(), body({ id: "n", name: "N", initiative: 1 }));
assert(last.order.join() === "a,b,c,n", "the lowest roll goes last");

const notStarted = insertIntoOrder(fight({ started: false, order: [] }),
  body({ id: "n", name: "N", initiative: 10 }));
assert(!notStarted.order.length, "before initiative is rolled there is no order to join");

// --- encounter difficulty, against the stated approximation
const { rateEncounter } = await import("../src/combat.js");
const party4x5 = [1, 2, 3, 4].map(() => ({ level: 5 }));
const band = (enemies: { cr: number; xp: number }[]) => rateEncounter(enemies, party4x5)!.band;

assert(rateEncounter([], party4x5) === null, "no enemies means no rating");
assert(rateEncounter([{ cr: 5, xp: 1800 }], []) === null, "no party means no rating");
assert(band([{ cr: 0.25, xp: 50 }]) === "trivial", "one goblin against four fifth-level heroes is trivial");
assert(band(Array(4).fill({ cr: 0.25, xp: 50 })) === "easy", "four goblins are easy");
assert(band([{ cr: 5, xp: 1800 }]) === "moderate", "a lone equal-level threat is moderate");
assert(band([{ cr: 10, xp: 5900 }]) === "deadly", "twice the party's weight is deadly");
assert(rateEncounter(Array(3).fill({ cr: 1, xp: 200 }), party4x5)!.xp === 600,
  "XP is summed straight off the stat blocks");
assert(band(Array(8).fill({ cr: 0.25, xp: 50 })) === "moderate",
  "numbers count for something: eight goblins outrank four");

// --- questions answered from the fight in progress
const { answerFromCombat } = await import("../src/combat-answers.js");
const ruleMap = new Map<string, Rule>([
  ["prone", { id: "prone", title: "Prone", group: "rules", category: "condition", body: "" }],
  ["grappled", { id: "grappled", title: "Grappled", group: "rules", category: "condition", body: "" }],
]);
const dave = body({
  id: "d", name: "Dave", isPlayer: true, level: 5, speed: 30,
  actions: [{ id: "s1", name: "Fireball", kind: "spell", cost: "action", ruleId: "spell-fireball" }],
});
const running = (over: Record<string, unknown> = {}) => ({
  round: 1, turn: 0, started: true, dmOverride: false, log: [],
  combatants: [dave], order: ["d"], ...over,
}) as Parameters<typeof answerFromCombat>[1];

const ask = (q: string, subject = dave, enc = running()) =>
  answerFromCombat(q, enc, subject, ruleMap);

assert(ask("fireball") === null, "a plain lookup is not treated as a question");
assert(answerFromCombat("can I move", running({ started: false }), dave, ruleMap) === null,
  "no verdict before the fight has started");
assert(ask("can I move")?.verdict === "yes", "a mobile character can move");
assert(ask("can I move", body({ ...dave, conditions: ["grappled"] }))?.verdict === "no",
  "grappled drops speed to 0, so the answer is no");
assert(ask("can Dave attack")?.subject.name === "Dave", "a name in the question picks the subject");
assert(ask("can I attack", body({ ...dave, actionUsed: true }))?.verdict === "no",
  "an action already spent means no attack");
assert(ask("do I have my reaction")?.verdict === "yes", "an unspent reaction is available");
assert(ask("can I cast fireball")?.headline.includes("Fireball"),
  "a spell on the sheet is recognised by name");
assert(ask("can I cast fireball", body({ ...dave, conditions: ["prone"], hp: 0 }))?.verdict === "no",
  "a character at 0 hit points cannot cast");

// --- body text splits into paragraphs and tables
const { parseBlocks } = await import("../src/ui/markup.js");

assert(parseBlocks("Just prose.").every((b) => b.kind === "paragraph"),
  "text with no pipes stays a single paragraph");

const doc = parseBlocks([
  "Intro line.",
  "",
  "_Table: Star Heart Clone",
  "| d20     | Effect            |",
  "| ------- | ----------------- |",
  "| 1       | Lifeless.         |",
  "| 2-11    | Nothing.          |",
  "",
  "Trailing line.",
].join("\n"));

assert(doc.length === 3, "an intro, a table and a tail are three blocks");
const tbl = doc[1];
assert(tbl.kind === "table" && tbl.caption === "Star Heart Clone", "the caption is lifted off the table");
assert(tbl.kind === "table" && tbl.header.join() === "d20,Effect", "the header row is separated out");
assert(tbl.kind === "table" && tbl.rows.length === 2, "the dashed rule is not a row");
assert(tbl.kind === "table" && tbl.rows[1].join() === "2-11,Nothing.", "cells are trimmed of padding");
assert(doc[2].kind === "paragraph" && doc[2].text === "Trailing line.",
  "text after the table is its own paragraph");

const twoTables = parseBlocks([
  "| d8 | Creature |", "| -- | -------- |", "| 01 | Weasel   |",
  "", "Rust Bag:", "",
  "| d8 | Creature |", "| -- | -------- |", "| 01 | Rat      |",
].join("\n"));
assert(twoTables.filter((b) => b.kind === "table").length === 2,
  "an entry can carry more than one table");

const orphan = parseBlocks("_Table: Nothing Follows\nplain text");
assert(orphan.every((b) => b.kind === "paragraph"),
  "a caption with no table under it is left as text");
assert(orphan[0].kind === "paragraph" && orphan[0].text.startsWith("_Table: Nothing Follows"),
  "and is kept verbatim rather than being silently dropped");

// --- spell shapes and upcasting, read out of the spell's own prose
const { spellShape, spellScaling, diceAtLevel } = await import("../src/spells.js");
const spell = (over: Record<string, unknown>) => ({
  id: "s", title: "S", group: "spells", category: "evocation", body: "",
  spell: {
    level: 3, school: "evocation", castingTime: "1 action", range: "150 feet",
    components: "V, S", duration: "Instantaneous", concentration: false, ritual: false, classes: [],
  },
  ...over,
}) as Rule;

const shapeOf = (body: string, over: Record<string, unknown> = {}) =>
  spellShape(spell({ body, ...over }));

assert(shapeOf("Each creature in a 20-foot-radius sphere")?.kind === "sphere", "a sphere is read off the text");
assert(shapeOf("Each creature in a 20-foot-radius sphere")?.size === 20, "with its radius in feet");
assert(shapeOf("a 60-foot cone")?.kind === "cone", "a cone is recognised");
assert(shapeOf("a 15-foot cube originating from you")?.kind === "cube", "a cube is recognised");
assert(shapeOf("a line 100 feet long and 5 feet wide")?.extent === 5, "an explicit line keeps its width");
assert(shapeOf("a line 100 feet long and 5 feet wide")?.size === 100, "and its length");
// The looser rule must not fire on prose that merely mentions a length.
assert(shapeOf("you create a rope 60 feet long")?.kind !== "line",
  "a rope 60 feet long is not an area of effect");
assert(shapeOf("a wall of fire up to 60 feet long")?.kind === "line", "a wall is a line");
assert(shapeOf("a 10-foot-radius, 20-foot-tall cylinder")?.kind === "cylinder", "a cylinder is recognised");

// With no area, how the spell reaches is worth showing instead.
assert(shapeOf("", { spell: { ...spell({}).spell!, range: "Touch" } })?.kind === "touch", "touch spells show reach");
assert(shapeOf("", { spell: { ...spell({}).spell!, range: "Self" } })?.kind === "self", "self spells show self");
assert(shapeOf("")?.kind === "target", "a ranged spell with no area is a single target");
assert(shapeOf("", { spell: { ...spell({}).spell!, range: "Special" } }) === null,
  "an unparseable range gets no diagram rather than a wrong one");

// --- scaling
const fireball = spell({
  body: "A target takes 8d6 fire damage",
  spell: { ...spell({}).spell!, higherLevel: "the damage increases by 1d6 for each slot level above 3rd" },
});
const fbScale = spellScaling(fireball)!;
assert(fbScale.kind === "slot", "a levelled spell scales by slot");
assert(diceAtLevel(fbScale, 3).expr === "8d6", "at its own level it rolls its base");
assert(diceAtLevel(fbScale, 5).expr === "10d6", "two slots up adds two dice");
assert(diceAtLevel(fbScale, 9).expr === "14d6", "and six slots up adds six");

const cantrip = spell({
  level: 0,
  body: "takes 1d10 fire damage. This spell's damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).",
  spell: { ...spell({}).spell!, level: 0 },
});
const cScale = spellScaling(cantrip)!;
assert(cScale.kind === "cantrip", "a cantrip scales by character level");
assert(diceAtLevel(cScale, 4).expr === "1d10", "below the first step it rolls its base");
assert(diceAtLevel(cScale, 5).expr === "2d10", "at 5th it steps up");
assert(diceAtLevel(cScale, 20).expr === "4d10", "and stops at the last step");

assert(spellScaling(spell({ body: "You create three glowing darts" })) === null,
  "a spell with no dice has nothing to scale");
assert(spellScaling(spell({
  body: "takes 2d8 damage",
  spell: { ...spell({}).spell!, higherLevel: "the duration increases by 1 hour for each slot level above 3rd" },
})) === null, "scaling that is not dice — duration, range — is left alone");
