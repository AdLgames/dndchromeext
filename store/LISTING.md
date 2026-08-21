# Chrome Web Store listing

Everything the submission form asks for, ready to paste. Fields are in the
order the developer dashboard presents them.

---

## Store listing tab

**Name** (max 75)

```
Rules Overlay for D&D 5e
```

> ⚠️ See "Before you submit" at the bottom — the name is the one thing worth
> deciding on before you upload.

**Short description** (max 132 — this is the manifest `description`)

```
Press a hotkey, type a rule or table-slang, get the D&D 5e SRD answer inline. Bundled, offline, no network calls.
```

**Category:** Productivity
**Language:** English (UK)

**Detailed description**

```
A rules lookup that is faster than the book and faster than a search engine,
because everything is already on your machine.

Press Ctrl+Shift+Space anywhere — including inside a virtual tabletop's canvas
— and type. "Aoo" finds Opportunity Attack. "Short sword" finds Shortsword.
"What happens if I'm knocked off my mount" finds Mounted Combat and offers to
walk you through it. Results appear in under a tenth of a second because
there is no network call to wait for.

WHAT IS IN IT
• 2,059 entries: rules, spells, monsters, magic items, class features
• Three openly licensed packs — D&D SRD 5.1, Level Up: Advanced 5e, and the
  Black Flag SRD — each switchable on or off
• An alias table mapping table-slang to the rule it means

AT THE TABLE
• Every dice expression is a button. Click 8d6 in Fireball and it rolls.
• Spells show what they cover: a sphere, cone, cube or line drawn to scale on
  a five-foot grid, with the caster marked
• Cast a spell higher and the dice follow — Fireball at 3rd is 8d6, at 9th
  it is 14d6
• A dice tray with d4 through d100 and a roll history
• "Explain simply" gives dense rules a plain-English summary and a worked
  example

COMBAT
• Initiative for everyone at once, with a turn order that stays put
• Attack rolls, saving throws, damage, temporary hit points, death saves
• Conditions that actually change the maths — advantage, disadvantage,
  automatic criticals, speed reduced to zero — with every roll saying which
  conditions shaped it
• Concentration checked automatically when damage lands
• Twelve steps of undo
• An encounter difficulty readout, and a filterable combat log

YOUR OWN CONTENT
• Write your own monsters, spells, items, rules and features. They are
  searched, filtered and fought exactly like the published ones.
• Copy any published entry into your homebrew to use as a starting point
• A party roster whose characters bring their weapons and spells into combat
• Attach your own pictures to anything
• Export the lot — characters, homebrew and pictures — as one file

PRIVACY
No account, no server, no analytics, no telemetry, no network requests at
all. Everything is stored on your own machine. The full policy is at
https://github.com/AdLgames/dndchromeext/blob/main/PRIVACY.md

ATTRIBUTION
Includes material from the D&D System Reference Document 5.1, © Wizards of
the Coast LLC, licensed under CC BY 4.0. Also includes material from the A5E
SRD (EN Publishing, CC BY 4.0) and the Black Flag SRD (Kobold Press, ORC).
This extension is unofficial and is not affiliated with, endorsed by, or
sponsored by Wizards of the Coast.
```

**Screenshots** — five 1280×800 PNGs in `store/screenshots/`. Upload in this
order; the first is the one people see in search results.

| File | Shows |
| --- | --- |
| `1-search.png` | Searching "fireball" beside a game page |
| `2-spell.png` | A spell with its area diagram and upcast stepper |
| `3-combat.png` | The combat tracker mid-fight |
| `4-monster.png` | A monster stat block with rollable attacks |
| `5-dice.png` | The dice tray and roll history |

Regenerate them with the steps in `store/SCREENSHOTS.md`.

---

## Privacy tab

**Single purpose**

```
Look up tabletop roleplaying rules from a bundled, offline copy of openly
licensed reference material, without leaving the page you are on.
```

**Permission justifications**

| Permission | Justification to paste |
| --- | --- |
| `storage` | Stores the user's own settings, party, homebrew entries, pictures and current encounter on their machine. Nothing is transmitted. |
| `sidePanel` | Provides the docked side-panel view of the same rules lookup, as an alternative to the hotkey overlay. |
| `downloads` | Writes the export file when the user presses Export, so they can back up or share their characters and homebrew. Used only in response to that click. |
| Host permission (`<all_urls>`) | The extension's purpose is a rules lookup that opens over whatever page the user is on — usually a virtual tabletop or a wiki. The content script listens for the keyboard shortcut and draws the overlay. It does not read page content, except the user's own text selection when they explicitly press the lookup shortcut. It makes no network requests. |

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage** — tick nothing. The extension collects none of the listed
categories. Then certify:
- ☑ I do not sell or transfer user data to third parties, outside of approved use cases
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://github.com/AdLgames/dndchromeext/blob/main/PRIVACY.md
```

---

## Before you submit

**1. The name.** "D&D" and "Dungeons & Dragons" are Wizards of the Coast
trademarks. The SRD's licence does not help here: CC BY 4.0 says in terms
that "Patent and trademark rights are not licensed under this Public
License". Using the SRD's *text* is fine and is what the licence is for;
putting the trademark in a product name is a separate question, and it is the
sort of thing that gets a listing pulled after it has users rather than
before. Most third-party tools avoid it — "5e" alone reads as generic. A
safer name would be something like:

```
Rules Overlay for 5e
```

with the SRD attribution and the "not affiliated with Wizards of the Coast"
line kept in the description exactly as above. Changing it means editing
`manifest.json` and the short description. This is a judgement call, not a
certainty — but it is cheaper to make now than later.

**2. A code licence.** The repository has none, which means nobody else may
legally reuse the source. Fine if that is deliberate; add a `LICENSE` if not.

**3. Cost and timing.** A Chrome Web Store developer account is a one-off
$5 registration. First reviews commonly take a few days, and can take longer
for an extension requesting access to all sites — expect questions about
that permission, which the justification above is written to answer.

---

## Icon

`icons/icon{16,48,128}.png`, drawn from the SVG masters beside them and
regenerated with `npm run icons`.

A d20 inside the diamond that the panel header already uses as its mark, in
the Book theme's own `--color-bg` on `--color-accent`. The previous icon was
a white diamond on violet — a colour that appears nowhere else in the
product.

The 16px is drawn differently from the other two, and deliberately: at that
size the diamond outline and the die outline fuse into a blobby ring with no
die visible in it. It is redrawn as a solid diamond with the die's face
knocked out of it, so the contrast carrying the shape is fill against
knockout rather than two thin strokes two pixels apart. Checked at native
size against both Chrome toolbars, light and dark.

If you want a 440×280 promotional tile as well, the same mark on a
`--color-accent-900` ground with the wordmark beside it would suit — that one
is optional and the listing works without it.
