# Rules Overlay for D&D 5e

A hotkey-triggered rules lookup overlay for D&D 5e players. Press a key
anywhere in the browser, type a partial rule or table-slang, get the rule
inline without leaving the current tab.

Everything is bundled at build time. **No network calls at runtime, ever** —
it works on convention-center wifi, or with no wifi at all.

## Install (unpacked, for development/testing)

```sh
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder.

## Use it

- Press **Ctrl+Shift+Space** (**Cmd+Shift+Space** on Mac) anywhere in the tab
  — including while focus is inside a VTT canvas or iframe — to open the
  overlay.
- Select text on any page and press **Ctrl+Shift+D** to look that phrase up
  directly in the side panel.
- Type a name, table-slang ("aoo", "crit", "conc"), or a natural question
  ("how far can i jump"). Results rank by alias hit, title match, fuzzy
  match, then body text, with a boost for entries you've opened recently,
  and are grouped by source with the strongest group first.
- **↑/↓** to move the selection, **Enter** to open an entry, **Esc** to go
  back (then to clear the query, then to close), click outside to close.
- **Pin** an entry from its header to keep it in a persistent list — handy
  for the statblock you're running this combat. The pinned view shows a
  condensed AC/HP/speed line plus its attacks.
- **Search** and **Combat** are top-level tabs, so you can flip between
  looking something up and running the fight without losing either.

**Back returns you to what you were doing**, not to the front page: the
catalogue you were scrolling — with its filters and your place in the list —
the search results you had, the pinned list, or the Homebrew tab. It chains,
so following cross-references from entry to entry and then walking back out
retraces the way you came. Escape does the same thing.

### Browsing and filtering

Tapping a category on the home screen opens its **full catalogue** — all 405
monsters, all 377 spells — rather than a capped search. Each catalogue
filters on the stats that matter for it:

- **Bestiary**: CR, AC and HP ranges, creature type; sort by CR, AC or HP.
- **Spells**: level range, school, concentration/ritual.
- **Items**: rarity. **Classes**: level.

The same filters work straight from the search box using comparisons —
`ac>=17 cr<=5`, `dragon cr>=10`, `level<3 fire` — mixing a stat filter with
ordinary text.

### Beyond looking rules up

- **Ask it a question.** "What happens if I'm knocked off my mount" finds
  Mounted Combat without you knowing the rule's name — and offers a
  **walkthrough** that steps through dismounting, the DC 10 Dex save, fall
  damage, going prone, and the concentration check, with the dice for each
  step attached.
- **A dice tray** behind the dice icon: d4 through d100, a box for anything
  else (`2d6 + 3`), and the roll history — every roll the panel makes
  anywhere, attacks and saves included, with *Again* to repeat one. The last
  roll still sits above the footer, and clicking it opens the tray.
- **Ask about the fight in progress.** With an encounter running, "can I
  move", "can Dave attack", "do I have my reaction" get answered from the
  encounter itself — conditions, speed already spent, action economy,
  concentration — with the reasoning shown, above the usual ranked rules.
  It understands a deliberately small set of questions; anything it doesn't
  recognise just falls through to the rules lookup it would have shown
  anyway.
- **Every spell gets a diagram.** A sphere, cone, cube, line or cylinder is
  drawn to scale on a five-foot grid with the caster's position marked, so
  "20-foot radius" becomes four squares you can count onto a battle map.
  Spells with no area show how they reach instead — touch, self, or a single
  target at range. The shape is read out of the spell's own prose, since 5e
  keeps it there and not in any structured field; a wording that isn't
  recognised gets no diagram rather than a wrong one (369 of 377 spells are
  covered).
- **Cast it higher and it rolls higher.** Spells that grow with the slot get
  a stepper: move the slot level and the dice follow — Fireball at 3rd is
  8d6, at 9th it's 14d6 — with a button to roll whatever that comes to.
  Cantrips step on character level instead (Fire Bolt: 1d10, then 2d10 at
  5th, 3d10 at 11th, 4d10 at 17th). Spells whose higher-level note changes
  the duration or the number of targets rather than the dice are left alone,
  because there is nothing there to roll.
- **Tables are tables.** Where an entry's text carries a `d20 | Effect`
  roll table, it is rendered as one — with the die results in their own
  column and the dice inside still clickable — rather than as the wall of
  pipes and dashes the source markdown would otherwise put on screen.
- **Roll anything.** Every dice expression in the text is a button:
  `1d10 + 2` in a monster's bite, `8d6` in Fireball, `2d4 + 2` on a healing
  potion. Fall damage asks how far you fell and rolls the right number of
  dice. The last roll stays pinned above the footer.
- **Explain simply.** Dense rules carry a hand-written TL;DR and a worked
  example — useful for newer players, and quicker than re-parsing the SRD's
  prose mid-turn.
- **Quick actions** on each rule: roll the relevant check, jump to the rules
  it interacts with, start a walkthrough, pin it, or drop a monster into the
  tracker.
- **Related rules** turns `seeAlso` into a real graph — links are followed in
  both directions, so Prone lists everything that can knock you down, not
  just what it happens to point at.
- **Scale a monster** from its stat block: step the CR up or down and HP,
  AC, attack bonuses, save DCs and damage dice all move with it, so a
  goblin can menace a level-8 party. Adding a scaled monster to combat
  carries the adjusted numbers over. This is explicitly homebrew — the SRD
  has no official scaling rules — and the panel says so.
- **Combat tracker** (its own tab) runs a turn-based fight, split into
  **Characters** and **Enemies**:

  0. The two sides are separated and styled apart — your characters on the
     warm parchment with an amber edge and an outlined *PC* tag, the
     opposition on the darker surface with an ink edge and a solid *Enemy*
     tag. Each header counts who is still up ("1 of 2 up"). Every row keeps
     its turn number, so the initiative sequence is still readable while
     "how is my side doing" stops being a scan through interleaved rows.
  1. **Roll initiative for all** rolls d20 + Dex for everyone at once and
     freezes the turn order (stored, so editing a number later doesn't
     silently reshuffle whose turn it is). Anyone who **joins a fight already
     in progress** rolls their own initiative and is slotted into the running
     order at the right place — reinforcements get a turn instead of sitting
     at the bottom of the list where their turn never comes round.
  2. Only the combatant whose turn it is can act. Their action, bonus
     action, reaction and remaining movement show in the turn banner and are
     spent as they're used, refreshing when their turn comes round again.
     *Turn order off* lets the DM act out of sequence when the table needs it.
  3. Pick one of that combatant's **weapons, spells or items** — party
     members bring theirs straight off their character sheet — then pick a
     target. Attack rolls go against the target's AC; save-based effects
     make the target roll against the DC, halving or avoiding the damage.
  4. Damage lands on the target, coming off temporary hit points first, and
     is stored. Dropping to 0 applies unconscious and prone to a player
     character, who is then dying and rolling death saves; anything else dies
     outright at 0, as 5e says. **The dead are named in red, struck through
     and marked *(deceased)***, they stop rolling death saves, and the log
     says "dead" rather than "unconscious" — a corpse is not something that
     might get up.

  **Conditions actually change the maths.** Attacking a prone target is
  advantage in melee and disadvantage at range; blinded, frightened,
  poisoned or restrained attackers roll at disadvantage; a hit on a
  paralysed or unconscious target in melee is an automatic critical;
  grappled, restrained, paralysed or stunned drops speed to 0; and
  incapacitating conditions stop that combatant acting at all. Every roll
  says which conditions shaped it. Advantage and disadvantage cancel per
  5e's rule, however many of each apply.

  Damage taken while concentrating immediately rolls the Constitution save
  at DC 10 or half the damage. Death saves roll and tally themselves. A
  combat log records the arithmetic so the table can check it, filtered by
  **attacks / damage / healing / saves / conditions / notes** — conditions
  are logged too, so a sudden disadvantage three turns on has a visible
  cause.

  **Undo** walks back up to twelve steps, from the round bar. It covers
  everything the tracker does — damage, healing, conditions, turn changes,
  adding and removing combatants — and is persisted, so it survives closing
  the panel and is shared between the overlay and the side panel. Ending an
  encounter clears it, since undoing into a fight you deliberately cleared
  away is not a kindness.

  **Names are editable**: click any combatant to rename them. Duplicates are
  numbered as a run — adding a second Badger renames the first to *Badger 1*
  — and a name you chose yourself is never overwritten. The **+** on an
  enemy's row adds another of the same creature, which is how encounters
  actually get built.

  A **difficulty band** — trivial to deadly — sits above the list with the
  enemy count and their total XP. The XP is the real figure off the stat
  blocks; the band is the extension's **own approximation**, because the SRD
  carries stat blocks but none of the encounter-building tables, so there is
  nothing openly licensed to implement. It weighs one challenge rating per
  four character levels, plus a little for numbers, and the panel says as
  much when you ask it.

  Numbers for party members are derived the way 5e does — ability modifier
  plus proficiency for the level, with a weapon's finesse/ranged properties
  choosing the ability and a caster's class choosing their spell ability —
  and every one of them stays editable.
- **A picture for every entry.** Each creature, item, spell and rule carries
  an emblem: a glyph for what it is (its creature type, item category or
  spell school) over a tint and corner mark derived from a hash of its id,
  so entries stay individually recognisable and look the same every session.
  Nothing is downloaded — see *Why the pictures are drawn, not shipped*
  below. Any entry (and any party member) can take **your own picture**
  instead: open it, press *Add picture*, and the file is squared, shrunk to
  160px and kept in local storage on that machine. *Remove* puts the emblem
  back.
- **Published entries are locked; yours are not.** Every entry says which it
  is. Anything from a content pack carries a **SRD 5.1 · locked** chip — its
  text and stats are the published text and stats, and nothing in the panel
  edits them. Your own carry **Yours · editable** with edit and delete
  instead. The lock is enforced at the storage layer too: an imported entry
  is forced into the homebrew namespace and cannot claim to be SRD or shadow
  a bundled slug.
- **Copy to my homebrew** turns any locked entry into a starting point: it
  duplicates the whole stat block into your own entries, where it *is*
  editable, and leaves the original untouched. It copies **what is on
  screen** — scale a goblin to CR 2 first and the copy is a CR 2 goblin,
  with the raised HP, AC, attack bonuses and damage baked in.
- **Write your own.** The **Homebrew tab** lists everything you have written,
  grouped by kind, with edit, delete, and — for your monsters — *To combat*
  on each. Entries behave exactly like
  published ones: searched, browsed, filtered by AC/CR, pinned, rolled from,
  scaled, and dropped into the combat tracker, tagged **Your homebrew** and
  switchable off in settings like any other pack. A monster gets the full
  stat block — abilities, saves, senses, traits, actions, reactions,
  legendary actions — and each action row shows *what the combat engine
  parses out of it*, so a mistyped damage line is visible while you write it
  rather than as a missing attack mid-fight. Your entries can be picked onto
  a character sheet too, and each one can take a picture.
- **Party roster** (the other tab): characters with stats, plus
  spells/actions/items picked from the SRD, from your own entries, **or
  typed in as free text**. **Class is a picker**, listing the classes the
  loaded packs describe — combat derives a caster's spell ability from this
  field, so a typo used to cost them their spellcasting silently. *Other…*
  still takes anything you like, it just has to be chosen on purpose.
  Everything autosaves as you type — there is no save button to forget.
- **One file for all of it.** Export writes your characters, your homebrew
  and **every picture you have uploaded** — including ones you put on
  published entries, since those are the part of a long campaign that cannot
  be regenerated. Import merges by id, so loading a file twice updates
  rather than duplicates, and party files exported before homebrew existed
  still load.

Rebind either hotkey at `chrome://extensions/shortcuts` if it collides with
something else (e.g. a VTT's own shortcuts).

Prefer something pinned open instead of a toggle? Click the extension's
toolbar icon to open it as a **side panel** — same search, same data, just
docked in the browser's sidebar instead of overlaid on the page. The hotkey
overlay and the side panel are independent; use whichever fits how you play.
Both surfaces reflow all the way down: the header drops the source tag and
then truncates the title before its buttons can be pushed off the edge, and
the tabs give up their letter-spacing and counts before their labels. Below
260px the panel collapses to a marker rail rather than showing something
clipped.

The panel header carries four buttons: **pinned**, **your party**, the
**combat tracker**, and **settings**. Each lights up when it has something in
it, so the party is one click away from wherever you are rather than buried
in settings.

### Settings

Open settings from the panel header (the sliders icon) to choose which
sources are searched, switch between **Match page / Light / Dark**, and turn
selected-text lookup on or off. The extension's options page
(`chrome://extensions` → Details → Extension options) additionally lists
your current shortcuts and the local log of searches that found nothing.

## Permissions, and what the extension can see

Four permissions, and one of them is broad. Taking them in turn:

| Declared | Why |
| --- | --- |
| `storage` | Everything the extension keeps — settings, pins, your party, your homebrew, your pictures, the encounter — lives in `chrome.storage.local` on this machine |
| `sidePanel` | The docked panel |
| `downloads` | Writing the export file when *you* press Export |
| `content_scripts: <all_urls>` | The point of the thing: the hotkey has to work on whatever VTT or wiki you happen to be on |

`<all_urls>` is the one worth being deliberate about, so:

- The content script **makes no network calls at all** and reads nothing off
  the page except a selection you explicitly ask it to look up with
  Ctrl+Shift+D. It mounts a closed shadow root, listens for the hotkey, and
  otherwise does nothing.
- It cannot run on `chrome://` pages, the Web Store, or other extensions'
  pages — Chrome forbids that regardless of what a manifest asks for. The
  Web Store is also excluded explicitly, so the intent is on the record
  rather than merely enforced.
- If you would rather it not run somewhere specific, Chrome can do that
  without any change here: extension menu → **This can read and change site
  data** → *On click*, or remove the host from the extension's site access
  list.

The bundled data files are declared `web_accessible_resources` because the
content script fetches them, and that declaration is what makes them
reachable from a page's origin. They carry **`use_dynamic_url: true`**, so
they are served from an origin that is regenerated each session rather than
from the extension's fixed id. Without it, any site's own JavaScript could
`fetch("chrome-extension://<fixed-id>/data/rules.json")` and, from whether
it succeeded, learn that you have this extension installed — a standard
extension-fingerprinting trick. Nothing leaves the device either way, but
the install should not be advertised to every page you visit.

## Development

```sh
npm run dev          # build once (unminified, sourcemapped) and watch
npm run icons        # redraw icons/*.png from icons/*.svg (needs Chrome)
npm run typecheck    # tsc --noEmit
npm test             # export/import round-trip and untrusted-input checks
npm run build:rules  # regenerate src/data/rules.json from data-src/
```

After any change, reload the unpacked extension at `chrome://extensions`
and refresh the tab you're testing in (content scripts don't hot-reload).

### Layout

```
src/
  background.ts        # service worker: hotkeys, selection capture, side-panel behavior
  search.ts             # alias resolution, ranking tiers, recency, question parsing
  dice.ts                # expression parsing, rolling, roll log
  scale.ts                # approximate monster CR scaling
  settings.ts             # sources / appearance / behavior, persisted locally
  pins.ts                  # pinned entry ids
  party.ts                  # party roster storage
  homebrew.ts                # your own entries + coercion of untrusted JSON
  spells.ts                   # area shapes and upcast scaling, parsed from prose
  portraits.ts                # your own pictures, downscaled into local storage
  backup.ts                    # one export/import bundle: party + homebrew + pictures
  combat.ts                  # turn order, action economy, condition effects, resolution
  types.ts                    # Rule, StatBlock, Flow, Character, Combatant
  ui/
    panel.ts                # the whole panel: browse, results, detail, pins, settings
    dom.ts                   # element builder, Lucide-style icons, match highlighting
    markup.ts                 # body text -> paragraphs and roll tables (DOM-free, tested)
    aoe.ts                     # the spell area diagrams
    emblem.ts                  # generated per-entry artwork (see below)
    theme.css                 # design tokens (light + dark)
    panel.css                  # component layer shared by both surfaces
  content/
    mount.ts                    # shadow host lifecycle: show/hide, focus, keydown isolation
    styles.css                   # overlay-only modal chrome
  sidepanel/ , options/           # thin hosts that mount the shared panel
  party/                           # "Your content": the roster and the homebrew editor
  data/
    rules.json                     # generated — do not hand-edit, see data-src/
    aliases.json                    # hand-authored table-slang → rule id map (the moat)
    flows.json                       # generated — decision walkthroughs
    sources.json                      # generated — per-pack licence notices
    load.ts                            # fetches the bundled JSON at runtime
data-src/
  srd-rules-source.json               # hand-authored: core mechanics + weapons
  rule-extras.json                     # hand-authored TL;DRs, examples, keywords, actions
  flows.json                            # hand-authored decision walkthroughs
  srd-{spells,monsters,magic-items,classes}-source.json   # generated by the importer
scripts/
  build-rules.ts                       # validates data-src/*.json -> src/data/rules.json
  import-srd-content.mjs                # importer: 5e-bits/5e-database (SRD 5.1) -> data-src/
  import-open5e.mjs                      # importer: open5e-api (A5E, Black Flag) -> data-src/
  rasterise-icons.mjs                    # icons/*.svg -> icons/*.png (npm run icons)
  crop-png.mjs                            # trims headless Chrome's screenshot band
  test-content.mts                        # npm test: export/import + untrusted-input checks
```

Both surfaces render from one `ui/panel.ts`; the overlay mounts it inside a
closed shadow root, the side panel mounts it in a normal page. The dataset is
**fetched** from the extension package rather than bundled — a
`chrome-extension://` read, not a network request — because the content
script is injected into every page and ~1.8 MB of SRD text does not belong
in it. It is prefetched while the page is idle so the first open stays fast.

`aliases.json` is the actual product: GMs say "aoo," not "opportunity
attack." Add entries there as slang and misspellings come up at your table —
resolve any genuinely ambiguous abbreviation by whichever meaning comes up
more often, not alphabetically.

`rules.json` is generated by `scripts/build-rules.ts`, which reads every
`data-src/*.json` source file, validates that every id is a unique slug and
every `seeAlso` reference resolves, and writes the merged output. Run
`npm run build:rules` (or `npm run build`) to regenerate after editing a
source file.

`srd-rules-source.json` (core mechanics, conditions, spellcasting rules,
weapons), `rule-extras.json` and `flows.json` are hand-authored — edit them
directly; the build validates that every id, `seeAlso`, quick action and
flow step points at a rule that actually exists. The other four source files
are machine-generated by `scripts/import-srd-content.mjs` from
[5e-bits/5e-database](https://github.com/5e-bits/5e-database), an
MIT-licensed structuring of the same SRD 5.1 content. Don't hand-edit
those — to refresh them (e.g. after an upstream update), clone that repo
and re-run:

```sh
git clone https://github.com/5e-bits/5e-database /path/to/5e-database
node scripts/import-srd-content.mjs /path/to/5e-database
npm run build:rules
```

## Content and licensing

This extension bundles rules content adapted from the **D&D System
Reference Document 5.1 ("SRD 5.1")**, © Wizards of the Coast LLC, available
at <https://dnd.wizards.com/resources/systems-reference-document>, and
licensed under the **Creative Commons Attribution 4.0 International License**
(<https://creativecommons.org/licenses/by/4.0/legalcode>). The attribution
notice is shown in the overlay's footer at all times.

Only openly licensed content goes in the bundle — no scraping paid
sourcebooks, no proxying to publisher sites. v1 targets a single system
(D&D 5e SRD) rather than shipping multiple half-populated systems.

### Content packs

Three openly licensed packs ship together, each carrying the notice its
licence requires. The footer shows the notice belonging to whatever entry is
on screen, entries from a non-SRD pack are tagged in the results, and each
pack can be switched off in settings.

| Pack | Licence | What it adds |
| --- | --- | --- |
| **D&D SRD 5.1** © Wizards of the Coast | CC BY 4.0 | 1,553 entries — 78 rules, 319 spells, 334 monsters, 403 items, 419 class features |
| **Level Up: Advanced 5e** (EN Publishing) | CC BY 4.0 | 435 entries — 306 magic items, 71 feats & backgrounds, 58 spells |
| **Black Flag SRD** (Kobold Press) | ORC | 71 monsters |
| **Your homebrew** | Yours | Whatever you write — unlocked, and the only pack that is |

2,059 entries in total. The packs overlap heavily — all three restate the
same core spells and creatures — so the build drops an entry when an
earlier-priority pack already has one with the same title in the same
group, keeping the SRD's wording as the canonical one. Roughly 800 entries
are duplicates removed this way.

Open5e also carries a large amount of **OGL 1.0a** material (Tome of Beasts,
Deep Magic, Creature Codex and more). It is deliberately *not* bundled:
redistributing it means shipping the OGL 1.0a text with an accurate Section
15 chain, which is a legal step to take deliberately rather than a side
effect of running an import script. `scripts/import-open5e.mjs` has an
explicit allow-list, so adding one is a conscious edit.

Monsters carry a real stat block — AC, HP and hit dice, CR/XP, proficiency,
speeds, ability scores with modifiers, saves, skills, immunities, senses,
languages, and traits/actions/reactions/legendary actions parsed into
separate collapsible sections, with attack bonuses and save DCs pulled out
of the prose.

## Why the pictures are drawn, not shipped

There is no art set that can legally and offline be bundled for two thousand
entries, so the extension draws its own.

- The **SRD 5.1** is text. It grants no artwork at all.
- **5e-bits/5e-database** stores only remote URLs (`/api/images/monsters/…`).
  Following one is a network request at runtime, which this extension never
  makes, and the images themselves are not covered by the data's licence.
- **Open5e** ships a handful of illustrations, but its "Modified MIT
  License" reads *"excepting artistic images included in this repository"* —
  they are explicitly carved out, so they must not be redistributed here.

Hence `src/ui/emblem.ts`: 45 single-stroke glyphs in the same geometric
idiom as the interface icons, one per creature type, item category and spell
school, placed over a tint and corner mark chosen by an FNV hash of the
entry's id. Every entry resolves to a real glyph — no entry falls through to
a generic placeholder — and the same entry looks the same every session.

`src/portraits.ts` is the escape hatch: your own image, squared and
downscaled to a 160px JPEG (~6 KB), stored in `chrome.storage.local` under
`rulesOverlay:portraits`, capped at 400 entries so it stays inside the
quota. It never leaves the machine, and it is keyed by rule id — or
`character:<id>` for party members, who are nobody's catalogue entry.

One caveat: images a content script adds to the page are still subject to
*that page's* Content-Security-Policy, so a site with a strict `img-src` can
block your uploaded portraits inside the hotkey overlay. The emblems are
inline SVG and always render, and the side panel is an extension page of its
own, so neither is affected.

## Design

The current look implements the "Rules Overlay" Claude Design canvas (Book
theme — warm parchment ground, amber accent), across its five states: idle
browse index, live grouped results, the collapsible entry view, settings &
sources, and the pinned / collapsed-rail pair.

Two deliberate departures from the mockup:

- **Fonts.** The canvas loads EB Garamond and Lora from Google Fonts. A
  webfont fetch is a runtime network request, which this extension never
  makes, so `--font-heading` / `--font-body` use serif stacks that ship with
  the OS instead.
- **The collapsed rail** is a responsive state, not a button: an extension
  can't resize Chrome's side panel, so the rail appears when *you* drag the
  panel narrow — below 260px, where the full layout stops being legible.

Narrow-width rules key off a **container query** on `.ro-root`, which is the
frame in the overlay and the body in the side panel. A media query would be
wrong for the overlay, whose frame is a fixed 420px inside a full-size page,
and only accidentally right for the side panel.

The blueprint frames and `+` registration marks in the canvas are the design
system's presentation convention for the canvas itself, not part of the
product surface, so they aren't reproduced here.

## Scope

Still deliberately out: no VTT context-reading (character sheets, active
system detection), no cloud sync or accounts, no homebrew rule entry, and
one game system per build.
