const PINS_KEY = "rulesOverlay:pins";
const PINS_MAX = 24;

export async function getPins(): Promise<string[]> {
  const stored = await chrome.storage.local.get(PINS_KEY);
  return (stored[PINS_KEY] as string[] | undefined) ?? [];
}

export async function togglePin(ruleId: string): Promise<string[]> {
  const pins = await getPins();
  const next = pins.includes(ruleId)
    ? pins.filter((id) => id !== ruleId)
    : [ruleId, ...pins].slice(0, PINS_MAX);
  await chrome.storage.local.set({ [PINS_KEY]: next });
  return next;
}

export async function clearPins(): Promise<void> {
  await chrome.storage.local.remove(PINS_KEY);
}

export function onPinsChanged(fn: (pins: string[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PINS_KEY]) fn(changes[PINS_KEY].newValue ?? []);
  });
}
