import type { AliasTable, Rule } from "../types";

export type SearchMatch = {
  rule: Rule;
  score: number;
  via: "alias" | "title" | "fuzzy" | "body";
};

// Ranking tiers, highest first. Each tier occupies its own score band so a
// weaker tier can never outrank a stronger one, but the recency multiplier
// (capped below) can still reorder entries *within* or across adjacent
// bands — that's the "recently viewed float up" behavior.
const SCORE_EXACT_ALIAS = 1000;
const SCORE_PREFIX_ALIAS = 900;
const SCORE_EXACT_TITLE = 800;
const SCORE_PREFIX_TITLE = 700;
const SCORE_FUZZY_ALIAS_MAX = 620;
const SCORE_FUZZY_TITLE_MAX = 600;
const SCORE_BODY_MATCH = 200;

const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_MAX_MULTIPLIER = 1.25;

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Strips everything but letters/digits. Used for alias/title comparisons so
 * "short sword", "short-sword", and "Shortsword" are all the same query —
 * a literal space in the query can otherwise never subsequence-match a
 * target that has no space at all, which silently loses real weapon/rule
 * names that happen to be one word ("Shortsword") when typed as two.
 */
function compactKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Subsequence fuzzy match: every character of `query` must appear in
 * `target` in order (not necessarily contiguous). Returns a 0..1 score
 * (1 = best) or null if query isn't a subsequence at all. Rewards
 * contiguous runs and early matches, like typical fuzzy-filter UX.
 */
function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return null;
  let qi = 0;
  let run = 0;
  let bestRun = 0;
  let firstMatchIndex = -1;
  let gaps = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (firstMatchIndex === -1) firstMatchIndex = ti;
      run += 1;
      bestRun = Math.max(bestRun, run);
      qi += 1;
    } else if (firstMatchIndex !== -1) {
      run = 0;
      gaps += 1;
    }
  }
  if (qi < query.length) return null; // not all query chars found in order

  const coverage = query.length / target.length;
  const contiguity = bestRun / query.length;
  const earliness = 1 - firstMatchIndex / Math.max(target.length, 1);
  const gapPenalty = Math.max(0, 1 - gaps * 0.08);

  return Math.max(
    0,
    Math.min(1, (coverage * 0.3 + contiguity * 0.4 + earliness * 0.2) * gapPenalty + 0.1)
  );
}

function recencyMultiplier(ruleId: string, recency: Record<string, number>, now: number): number {
  const viewedAt = recency[ruleId];
  if (!viewedAt) return 1;
  const age = now - viewedAt;
  if (age < 0 || age > RECENCY_WINDOW_MS) return 1;
  const freshness = 1 - age / RECENCY_WINDOW_MS; // 1 = just now, 0 = 7 days ago
  return 1 + freshness * (RECENCY_MAX_MULTIPLIER - 1);
}

export function buildAliasIndex(aliases: AliasTable): Map<string, string> {
  const index = new Map<string, string>();
  for (const [alias, ruleId] of Object.entries(aliases)) {
    index.set(normalize(alias), ruleId);
  }
  return index;
}

export function search(
  rawQuery: string,
  rules: Rule[],
  aliasIndex: Map<string, string>,
  recency: Record<string, number>,
  now: number = Date.now(),
  limit = 8
): SearchMatch[] {
  const spacedQuery = normalize(rawQuery);
  if (!spacedQuery) return [];
  const query = compactKey(rawQuery);

  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const best = new Map<string, SearchMatch>();

  const consider = (rule: Rule | undefined, score: number, via: SearchMatch["via"]) => {
    if (!rule) return;
    const existing = best.get(rule.id);
    if (!existing || score > existing.score) {
      best.set(rule.id, { rule, score, via });
    }
  };

  // Tier 1/2: alias hits (exact, then prefix).
  for (const [aliasText, ruleId] of aliasIndex) {
    const aliasKey = compactKey(aliasText);
    if (aliasKey === query) {
      consider(rulesById.get(ruleId), SCORE_EXACT_ALIAS, "alias");
    } else if (aliasKey.startsWith(query) && query.length >= 2) {
      // Shorter aliases matched by a short prefix are a stronger signal.
      const specificity = query.length / aliasKey.length;
      consider(rulesById.get(ruleId), SCORE_PREFIX_ALIAS * (0.7 + 0.3 * specificity), "alias");
    } else if (query.length >= 3) {
      const fs = fuzzyScore(query, aliasKey);
      if (fs !== null) {
        consider(rulesById.get(ruleId), fs * SCORE_FUZZY_ALIAS_MAX, "fuzzy");
      }
    }
  }

  // Tiers 3-6: title / body, direct against the rule set.
  for (const rule of rules) {
    const titleKey = compactKey(rule.title);
    if (titleKey === query) {
      consider(rule, SCORE_EXACT_TITLE, "title");
      continue;
    }
    if (titleKey.startsWith(query)) {
      consider(rule, SCORE_PREFIX_TITLE, "title");
      continue;
    }
    const titleFuzzy = fuzzyScore(query, titleKey);
    if (titleFuzzy !== null) {
      consider(rule, titleFuzzy * SCORE_FUZZY_TITLE_MAX, "fuzzy");
    }
    if (spacedQuery.length >= 3 && normalize(rule.body).includes(spacedQuery)) {
      consider(rule, SCORE_BODY_MATCH, "body");
    }
  }

  return Array.from(best.values())
    .map((match) => ({ ...match, score: match.score * recencyMultiplier(match.rule.id, recency, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const RECENCY_STORAGE_KEY = "rulesOverlay:recency";
const RECENCY_MAX_ENTRIES = 50;

export async function getRecency(): Promise<Record<string, number>> {
  const stored = await chrome.storage.local.get(RECENCY_STORAGE_KEY);
  return (stored[RECENCY_STORAGE_KEY] as Record<string, number> | undefined) ?? {};
}

/** Records a rule view and evicts the oldest entries past the storage cap. */
export async function recordView(ruleId: string): Promise<void> {
  const recency = await getRecency();
  recency[ruleId] = Date.now();

  const entries = Object.entries(recency).sort((a, b) => b[1] - a[1]);
  const capped = Object.fromEntries(entries.slice(0, RECENCY_MAX_ENTRIES));

  await chrome.storage.local.set({ [RECENCY_STORAGE_KEY]: capped });
}

const MISSES_STORAGE_KEY = "rulesOverlay:misses";
const MISSES_MAX_ENTRIES = 100;

export type SearchMiss = { query: string; count: number; lastSeen: number };

/**
 * Local-only "what did people search for and find nothing" log, so the
 * alias table (the actual product) can keep growing from real usage
 * without ever sending a query anywhere. Never touches the network.
 */
export async function getMisses(): Promise<SearchMiss[]> {
  const stored = await chrome.storage.local.get(MISSES_STORAGE_KEY);
  return (stored[MISSES_STORAGE_KEY] as SearchMiss[] | undefined) ?? [];
}

export async function recordMiss(rawQuery: string): Promise<void> {
  const key = normalize(rawQuery);
  if (!key) return;

  const misses = await getMisses();
  const existing = misses.find((m) => m.query === key);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = Date.now();
  } else {
    misses.push({ query: key, count: 1, lastSeen: Date.now() });
  }

  const capped = misses.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MISSES_MAX_ENTRIES);
  await chrome.storage.local.set({ [MISSES_STORAGE_KEY]: capped });
}

export async function clearMisses(): Promise<void> {
  await chrome.storage.local.remove(MISSES_STORAGE_KEY);
}
