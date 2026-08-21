# Privacy policy — Rules Overlay for D&D 5e

**Last updated: 21 August 2026**

## The short version

This extension does not collect, transmit, or sell any data. Nothing you do
in it leaves your computer.

## What it stores, and where

Everything the extension keeps is written to `chrome.storage.local`, which is
storage on your own machine belonging to this extension. That is:

| What | Why |
| --- | --- |
| Settings | Which content packs are searched, light/dark, whether selected-text lookup is on |
| Pinned entries | The rules you pinned for the current session |
| Your party | Characters you created, including their stats and equipment |
| Your homebrew | Monsters, spells, items, rules and features you wrote |
| Your pictures | Images you chose to attach to entries or characters |
| The encounter | The current combat tracker state, and its undo history |
| Roll history | Recent dice rolls |
| Searches that found nothing | Kept locally so the alias table can be improved; never sent anywhere |

None of it is transmitted. There is no account, no server, no analytics, no
telemetry, no advertising, and no third-party code in the extension.

## Network access

The extension makes **no network requests at runtime**. All rules content is
bundled inside the extension package and read from disk. You can verify this:
the code contains no `fetch` or `XMLHttpRequest` call to any remote host, and
the extension declares no host permissions for network access.

## What it can see on the pages you visit

The extension runs a content script on pages so the keyboard shortcut works
wherever you are. That script:

- **does not read page content**, with one exception: when you press
  Ctrl+Shift+D, it reads the text you have selected so it can look that phrase
  up. The selection is used to run a local search and is not stored or sent.
- does not observe browsing history, form input, cookies, or credentials.
- draws its interface in a closed shadow root, which the page cannot read.

## Permissions

- `storage` — to keep the data listed above on your machine.
- `sidePanel` — to open the docked panel.
- `downloads` — only to write the export file, and only when you press Export.
- Access to all sites — so the hotkey works on whatever virtual tabletop or
  wiki you are using. See above for what the content script actually does.

## Your data is yours

Export writes a single JSON file containing your characters, your homebrew,
and your pictures. Uninstalling the extension removes everything it stored.
There is nothing for us to delete, because we never had it.

## Contact

Please raise an issue at
<https://github.com/AdLgames/dndchromeext/issues>.
