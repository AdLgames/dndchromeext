import type { AliasTable, Flow, Rule, SourceRecord } from "../types";

export type Dataset = { rules: Rule[]; aliases: AliasTable; flows: Flow[]; sources: SourceRecord[] };

let pending: Promise<Dataset> | null = null;

/**
 * Reads the bundled dataset from the extension's own package. These are
 * `chrome-extension://` URLs — a local file read, not a network request —
 * so the offline guarantee holds. Keeping the data out of the JS bundle
 * matters most for the content script, which is injected into every page.
 */
export function loadDataset(): Promise<Dataset> {
  if (!pending) {
    const read = <T>(file: string) =>
      fetch(chrome.runtime.getURL(`data/${file}`)).then((r) => r.json() as Promise<T>);

    pending = Promise.all([
      read<Rule[]>("rules.json"),
      read<AliasTable>("aliases.json"),
      read<Flow[]>("flows.json"),
      read<SourceRecord[]>("sources.json"),
    ]).then(([rules, aliases, flows, sources]) => ({ rules, aliases, flows, sources }));
  }
  return pending;
}
