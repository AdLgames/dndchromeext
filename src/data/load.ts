import type { AliasTable, Rule } from "../types";

export type Dataset = { rules: Rule[]; aliases: AliasTable };

let pending: Promise<Dataset> | null = null;

/**
 * Reads the bundled dataset from the extension's own package. These are
 * `chrome-extension://` URLs — a local file read, not a network request —
 * so the offline guarantee holds. Keeping the data out of the JS bundle
 * matters most for the content script, which is injected into every page.
 */
export function loadDataset(): Promise<Dataset> {
  if (!pending) {
    pending = Promise.all([
      fetch(chrome.runtime.getURL("data/rules.json")).then((r) => r.json() as Promise<Rule[]>),
      fetch(chrome.runtime.getURL("data/aliases.json")).then((r) => r.json() as Promise<AliasTable>),
    ]).then(([rules, aliases]) => ({ rules, aliases }));
  }
  return pending;
}
