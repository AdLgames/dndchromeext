import { getHomebrew, sanitizeRule, saveHomebrew } from "./homebrew";
import { getParty, parsePartyFile, saveParty, type PartyFile } from "./party";
import { getPortraits, type Portraits } from "./portraits";
import type { Character, Rule } from "./types";

/**
 * One file carries everything a table would want to hand another player:
 * their characters, their homebrew, and the pictures attached to either.
 * Splitting them meant a shared monster arrived without its art, and a
 * character arrived without the homebrew items on their sheet.
 */
export type ContentFile = {
  format: "rules-overlay-content";
  version: 2;
  exported: string;
  characters: Character[];
  homebrew: Rule[];
  portraits: Portraits;
};

export type ContentBundle = {
  characters: Character[];
  homebrew: Rule[];
  portraits: Portraits;
};

const FORMAT = "rules-overlay-content";

export async function exportContent(): Promise<string> {
  const [characters, homebrew, portraits] = await Promise.all([
    getParty(), getHomebrew(), getPortraits(),
  ]);
  const file: ContentFile = {
    format: FORMAT,
    version: 2,
    exported: new Date().toISOString(),
    characters,
    homebrew,
    // Every picture, including ones put on published entries. They are the
    // only irreplaceable thing here — a campaign's faces built up over
    // months — and an export that quietly left most of them behind is not a
    // backup. The published *entries* still aren't shipped; only your art.
    portraits,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Reads either format: the current bundle, or a v1 party file from before
 * homebrew existed, so files already handed round the table still import.
 */
export function parseContentFile(text: string): ContentBundle {
  const data = JSON.parse(text) as Partial<ContentFile> & Partial<PartyFile>;

  if (data?.format === "rules-overlay-party") {
    return { characters: parsePartyFile(text), homebrew: [], portraits: {} };
  }

  if (data?.format !== FORMAT) {
    throw new Error("Not a Rules Overlay file.");
  }

  const characters = Array.isArray(data.characters)
    ? parsePartyFile(JSON.stringify({ format: "rules-overlay-party", version: 1, characters: data.characters }))
    : [];
  const homebrew = Array.isArray(data.homebrew) ? data.homebrew.map(sanitizeRule) : [];

  return { characters, homebrew, portraits: parsePortraits(data.portraits) };
}

/** Data URLs only: an imported `src` must never be able to point outward. */
function parsePortraits(raw: unknown): Portraits {
  if (!raw || typeof raw !== "object") return {};
  const out: Portraits = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) {
    if (typeof value === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Imports alongside what is already here rather than replacing it — someone
 * loading a friend's party should not lose their own.
 */
export async function importContent(bundle: ContentBundle): Promise<ContentBundle> {
  const [party, homebrew, portraits] = await Promise.all([
    getParty(), getHomebrew(), getPortraits(),
  ]);

  // Merge by id on both sides, so loading the same file twice updates what
  // is here rather than filling the page with duplicates.
  const merge = <T extends { id: string }>(mine: T[], theirs: T[]) => {
    const merged = [...mine];
    for (const entry of theirs) {
      const at = merged.findIndex((e) => e.id === entry.id);
      if (at >= 0) merged[at] = entry;
      else merged.push(entry);
    }
    return merged;
  };

  await Promise.all([
    saveParty(merge(party, bundle.characters)),
    saveHomebrew(merge(homebrew, bundle.homebrew)),
    chrome.storage.local.set({ "rulesOverlay:portraits": { ...portraits, ...bundle.portraits } }),
  ]);

  return bundle;
}
