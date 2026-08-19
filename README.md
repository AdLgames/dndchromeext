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

### Beyond looking rules up

- **Ask it a question.** "What happens if I'm knocked off my mount" finds
  Mounted Combat without you knowing the rule's name — and offers a
  **walkthrough** that steps through dismounting, the DC 10 Dex save, fall
  damage, going prone, and the concentration check, with the dice for each
  step attached.
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
- **Combat tracker** (crossed-swords icon): initiative order, HP, AC,
  conditions, concentration with its Con save, death-save pips, reaction
  used/ready, and movement remaining. Monsters come in with their stat block
  already filled in and their attacks one tap from a roll.
- **Party roster** (a full tab, linked from settings): characters with
  stats, plus spells/actions/items picked from the SRD **or typed in as free
  text** for homebrew. Export hands someone a party file; import loads one.

Rebind either hotkey at `chrome://extensions/shortcuts` if it collides with
something else (e.g. a VTT's own shortcuts).

Prefer something pinned open instead of a toggle? Click the extension's
toolbar icon to open it as a **side panel** — same search, same data, just
docked in the browser's sidebar instead of overlaid on the page. The hotkey
overlay and the side panel are independent; use whichever fits how you play.
Drag the panel narrow and it collapses to a marker rail.

### Settings

Open settings from the panel header (the sliders icon) to choose which
sources are searched, switch between **Match page / Light / Dark**, and turn
selected-text lookup on or off. The extension's options page
(`chrome://extensions` → Details → Extension options) additionally lists
your current shortcuts and the local log of searches that found nothing.

## Development

```sh
npm run dev          # build once (unminified, sourcemapped) and watch
npm run typecheck    # tsc --noEmit
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
  settings.ts             # sources / appearance / behavior, persisted locally
  pins.ts                  # pinned entry ids
  party.ts                  # party roster storage, export/import
  combat.ts                  # encounter state, initiative order, turn advance
  types.ts                    # Rule, StatBlock, Flow, Character, Combatant
  ui/
    panel.ts                # the whole panel: browse, results, detail, pins, settings
    dom.ts                   # element builder, Lucide-style icons, match highlighting
    theme.css                 # design tokens (light + dark)
    panel.css                  # component layer shared by both surfaces
  content/
    mount.ts                    # shadow host lifecycle: show/hide, focus, keydown isolation
    styles.css                   # overlay-only modal chrome
  sidepanel/ , options/           # thin hosts that mount the shared panel
  party/                           # the party roster page (its own tab)
  data/
    rules.json                     # generated — do not hand-edit, see data-src/
    aliases.json                    # hand-authored table-slang → rule id map (the moat)
    flows.json                       # generated — decision walkthroughs
    load.ts                           # fetches the bundled JSON at runtime
data-src/
  srd-rules-source.json               # hand-authored: core mechanics + weapons
  rule-extras.json                     # hand-authored TL;DRs, examples, keywords, actions
  flows.json                            # hand-authored decision walkthroughs
  srd-{spells,monsters,magic-items,classes}-source.json   # generated by the importer
scripts/
  build-rules.ts                       # validates data-src/*.json -> src/data/rules.json
  import-srd-content.mjs                # one-time importer, 5e-bits/5e-database -> data-src/
  gen-icons.mjs                          # generates icons/*.png (zero-dependency PNG encoder)
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

Coverage — 1,553 entries: core mechanics and conditions (78), the full
simple/martial weapons table plus magic items (403), spells (319), monster
stat blocks (334), and classes with their features (419).

Monsters carry a real stat block — AC, HP and hit dice, CR/XP, proficiency,
speeds, ability scores with modifiers, saves, skills, immunities, senses,
languages, and traits/actions/reactions/legendary actions parsed into
separate collapsible sections, with attack bonuses and save DCs pulled out
of the prose.

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
  panel narrow.

The blueprint frames and `+` registration marks in the canvas are the design
system's presentation convention for the canvas itself, not part of the
product surface, so they aren't reproduced here.

## Scope

Still deliberately out: no VTT context-reading (character sheets, active
system detection), no cloud sync or accounts, no homebrew rule entry, and
one game system per build.
