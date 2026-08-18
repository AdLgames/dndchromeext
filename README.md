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
- Type a rule name, table-slang ("aoo", "crit", "conc"), or a natural
  question ("how far can i jump"). Results rank by alias hit, title match,
  fuzzy match, then body text, with a boost for rules you've looked at
  recently.
- **↑/↓** to move the selection, **Enter** to open a rule, **Esc** to go back
  (or close if you're already at search), click outside to close.

Rebind the hotkey any time at `chrome://extensions/shortcuts` if it collides
with something else bound to Ctrl+Shift+Space (e.g. a VTT's own shortcuts).

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
  background.ts        # service worker: hotkey listener, forwards to content script
  content/
    mount.ts            # shadow host lifecycle: show/hide, focus, keydown isolation
    overlay.ts           # search input + results/detail rendering, keyboard nav
    search.ts            # alias resolution, ranking tiers, recency boost
    styles.css            # scoped inside the shadow root
  data/
    rules.json            # generated — do not hand-edit, see data-src/
    aliases.json            # hand-authored table-slang → rule id map (the moat)
data-src/
  srd-rules-source.json      # hand-authored SRD source content
scripts/
  build-rules.ts               # validates data-src/ and writes src/data/rules.json
  gen-icons.mjs                 # generates icons/*.png (zero-dependency PNG encoder)
```

`aliases.json` is the actual product: GMs say "aoo," not "opportunity
attack." Add entries there as slang and misspellings come up at your table —
resolve any genuinely ambiguous abbreviation by whichever meaning comes up
more often, not alphabetically.

`rules.json` is generated from `data-src/srd-rules-source.json` by
`scripts/build-rules.ts`, which validates that every id is a unique slug and
every `seeAlso` reference resolves before writing the output. Edit the
source file, then run `npm run build:rules` (or `npm run build`) to
regenerate.

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

## Scope

v1 is intentionally narrow — see the design notes for what's in scope and
what's deliberately deferred (no settings page, no VTT context-reading, no
cloud sync, no homebrew rule entry, one system per build).
