import { RULE_GROUPS, type RuleGroup } from "./types";

export type Appearance = "match" | "light" | "dark";

export type Settings = {
  sources: Record<RuleGroup, boolean>;
  /** Per-content-pack toggles, keyed by SourceRecord id ("srd" for SRD 5.1). */
  packs: Record<string, boolean>;
  appearance: Appearance;
  keepPinned: boolean;
  selectionLookup: boolean;
};

const SETTINGS_KEY = "rulesOverlay:settings";

export const DEFAULT_SETTINGS: Settings = {
  sources: Object.fromEntries(RULE_GROUPS.map((g) => [g, true])) as Record<RuleGroup, boolean>,
  packs: {},
  appearance: "match",
  keepPinned: true,
  selectionLookup: true,
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const saved = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    sources: { ...DEFAULT_SETTINGS.sources, ...saved?.sources },
    packs: { ...saved?.packs },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(fn: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) {
      fn({
        ...DEFAULT_SETTINGS,
        ...changes[SETTINGS_KEY].newValue,
        sources: { ...DEFAULT_SETTINGS.sources, ...changes[SETTINGS_KEY].newValue?.sources },
        packs: { ...changes[SETTINGS_KEY].newValue?.packs },
      });
    }
  });
}

/** Resolves "match" against the host page / OS preference. */
export function resolveTheme(appearance: Appearance): "light" | "dark" {
  if (appearance !== "match") return appearance;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
