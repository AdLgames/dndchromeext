const PORTRAITS_KEY = "rulesOverlay:portraits";

/** Downscaled edge length. Keeps a few hundred portraits inside the quota. */
const MAX_EDGE = 160;
const MAX_ENTRIES = 400;

export type Portraits = Record<string, string>; // rule id (or character key) -> data URL

/**
 * Party members aren't catalogue entries, so they get their own key space in
 * the same map rather than a second store to keep in sync.
 */
export function characterPortraitKey(characterId: string): string {
  return `character:${characterId}`;
}

export async function getPortraits(): Promise<Portraits> {
  const stored = await chrome.storage.local.get(PORTRAITS_KEY);
  return (stored[PORTRAITS_KEY] as Portraits | undefined) ?? {};
}

/**
 * Squares and shrinks the picture before storing it. Users hand this
 * full-resolution art; chrome.storage.local has a few megabytes in total, so
 * a 160px JPEG (~6 KB) is what actually gets kept.
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const edge = Math.min(MAX_EDGE, Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");

  // Cover-crop to a square so portraits line up in the lists.
  const scale = Math.max(edge / bitmap.width, edge / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (edge - width) / 2, (edge - height) / 2, width, height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", 0.82);
}

export async function setPortrait(ruleId: string, dataUrl: string): Promise<Portraits> {
  const portraits = await getPortraits();
  const next = { ...portraits, [ruleId]: dataUrl };

  // Oldest-first eviction isn't possible without timestamps, so cap by count
  // and drop whichever keys the map yields first — replacing is always fine.
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[key];
  }

  await chrome.storage.local.set({ [PORTRAITS_KEY]: next });
  return next;
}

export async function removePortrait(ruleId: string): Promise<Portraits> {
  const portraits = await getPortraits();
  delete portraits[ruleId];
  await chrome.storage.local.set({ [PORTRAITS_KEY]: portraits });
  return portraits;
}

export function onPortraitsChanged(fn: (portraits: Portraits) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PORTRAITS_KEY]) fn(changes[PORTRAITS_KEY].newValue ?? {});
  });
}
