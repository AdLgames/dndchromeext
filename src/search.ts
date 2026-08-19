import type { AliasTable, Flow, Rule, RuleGroup } from "./types";

export type SearchMatch = {
  rule: Rule;
  score: number;
  via: "alias" | "title" | "fuzzy" | "body" | "question";
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
const SCORE_QUESTION_MAX = 660;

const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_MAX_MULTIPLIER = 1.25;

/**
 * Words carrying no topic signal in a rules question. Dropping them lets
 * "what happens if I'm knocked off my mount" reduce to {knocked, mount},
 * which is what actually has to match.
 */
const STOPWORDS = new Set([
  "a", "about", "am", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by",
  "can", "cant", "could", "did", "do", "does", "doing", "dont", "for", "from", "get",
  "gets", "getting", "had", "has", "have", "how", "i", "if", "im", "in", "into", "is",
  "it", "its", "just", "me", "much", "my", "of", "off", "on", "or", "our", "out", "over",
  "should", "so", "some", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "to", "up", "use", "using", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "why", "will", "with", "would", "you",
  "your", "does", "happens", "happen", "many", "far", "long", "work", "works",
]);

/** Light stemmer: enough to tie "falling"/"falls"/"fall" together. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/** A query is treated as a question once it has several words to weigh. */
function looksLikeQuestion(query: string): boolean {
  return query.trim().split(/\s+/).length >= 3;
}

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

/**
 * Locates the query inside a title for result highlighting, comparing on
 * alphanumerics only so "short sword" still highlights within "Shortsword".
 * Returns a range in the ORIGINAL string, or null when there's no run to mark.
 */
export function findHighlight(title: string, rawQuery: string): [number, number] | null {
  const query = compactKey(rawQuery);
  if (!query) return null;

  // Map each compacted character back to its index in the original title.
  const positions: number[] = [];
  let compact = "";
  for (let i = 0; i < title.length; i++) {
    const ch = title[i].toLowerCase();
    if (ch >= "a" && ch <= "z") { compact += ch; positions.push(i); }
    else if (ch >= "0" && ch <= "9") { compact += ch; positions.push(i); }
  }

  const at = compact.indexOf(query);
  if (at === -1) return null;
  return [positions[at], positions[at + query.length - 1] + 1];
}

export function search(
  rawQuery: string,
  rules: Rule[],
  aliasIndex: Map<string, string>,
  recency: Record<string, number>,
  options: {
    now?: number; limit?: number;
    sources?: Record<RuleGroup, boolean>;
    packs?: Record<string, boolean>;
  } = {}
): SearchMatch[] {
  const { now = Date.now(), limit = 40, sources, packs } = options;

  const { filter, text: strippedQuery } = parseStatQuery(rawQuery);
  const filtering = isFilterActive(filter);

  const spacedQuery = normalize(strippedQuery);
  if (!spacedQuery && !filtering) return [];
  const query = compactKey(strippedQuery);

  let enabled = sources ? rules.filter((r) => sources[r.group] !== false) : rules;
  if (packs) enabled = enabled.filter((r) => packs[r.source ?? "srd"] !== false);
  if (filtering) enabled = enabled.filter((r) => matchesFilter(r, filter));

  // A pure stat query ("ac>18 cr<5") has no text to rank, so list the
  // matches themselves, cheapest ordering first.
  if (!spacedQuery) {
    return [...enabled]
      .sort((a, b) =>
        (a.monster && b.monster ? crValue(a.monster.cr) - crValue(b.monster.cr) : 0) ||
        a.title.localeCompare(b.title))
      .slice(0, limit)
      .map((rule) => ({ rule, score: 1, via: "body" as const }));
  }
  const rulesById = new Map(enabled.map((r) => [r.id, r]));
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
  for (const rule of enabled) {
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

  // Natural-language pass: people ask "what happens if I'm knocked off my
  // mount", not "mounted combat". Score topic-word overlap against the
  // title, the authored keywords, and (at lower weight) the body.
  if (looksLikeQuestion(spacedQuery)) {
    const asked = contentTokens(spacedQuery);
    if (asked.length) {
      for (const rule of enabled) {
        const title = new Set(contentTokens(rule.title));
        const keys = new Set((rule.keywords ?? []).flatMap((k) => contentTokens(k)));
        const body = new Set(contentTokens(rule.body.slice(0, 600)));

        let hits = 0;
        let weight = 0;
        for (const token of asked) {
          if (title.has(token)) { hits += 1; weight += 1; }
          else if (keys.has(token)) { hits += 1; weight += 0.9; }
          else if (body.has(token)) { hits += 1; weight += 0.35; }
        }
        if (hits < Math.min(2, asked.length)) continue;

        const coverage = weight / asked.length;
        consider(rule, coverage * SCORE_QUESTION_MAX, "question");
      }
    }
  }

  return Array.from(best.values())
    .map((match) => ({ ...match, score: match.score * recencyMultiplier(match.rule.id, recency, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ------------------------------------------------------- stat filters ---
export type Range = { min?: number; max?: number };

export type StatFilter = {
  cr?: Range;
  ac?: Range;
  hp?: Range;
  level?: Range;
  type?: string;
  school?: string;
  rarity?: string;
  concentration?: boolean;
  ritual?: boolean;
  name?: string;
};

function inRange(value: number | undefined, range: Range | undefined): boolean {
  if (!range || value === undefined) return !range;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

export function crValue(cr: string): number {
  if (cr.includes("/")) {
    const [a, b] = cr.split("/").map(Number);
    return b ? a / b : 0;
  }
  return Number(cr) || 0;
}

export function matchesFilter(rule: Rule, filter: StatFilter): boolean {
  if (filter.name && !rule.title.toLowerCase().includes(filter.name.toLowerCase())) return false;

  if (filter.cr || filter.ac || filter.hp || filter.type) {
    const m = rule.monster;
    if (!m) return false;
    if (!inRange(crValue(m.cr), filter.cr)) return false;
    if (!inRange(m.ac, filter.ac)) return false;
    if (!inRange(m.hp, filter.hp)) return false;
    if (filter.type && rule.category !== filter.type) return false;
  }

  if (filter.school || filter.concentration !== undefined || filter.ritual !== undefined) {
    if (!rule.spell) return false;
    if (filter.school && rule.spell.school.toLowerCase() !== filter.school.toLowerCase()) return false;
    if (filter.concentration !== undefined && rule.spell.concentration !== filter.concentration) return false;
    if (filter.ritual !== undefined && rule.spell.ritual !== filter.ritual) return false;
  }

  // "level" means spell level for spells and class level for features.
  if (filter.level) {
    const level = rule.spell?.level ?? rule.feature?.level;
    if (!inRange(level, filter.level)) return false;
  }

  if (filter.rarity) {
    if (!rule.item) return false;
    if (!rule.item.rarity.toLowerCase().includes(filter.rarity.toLowerCase())) return false;
  }

  return true;
}

export function isFilterActive(filter: StatFilter): boolean {
  return Object.values(filter).some((v) => v !== undefined && v !== "");
}

const STAT_TOKEN_RE = /\b(cr|ac|hp|level|lvl)\s*(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?|\d+\/\d+)\b/gi;

/**
 * Pulls "ac>15 cr<=5" style operators out of a query so they can filter the
 * pool, and returns whatever text is left for ordinary matching. Lets the
 * search box answer "which monsters can I actually hit" without a UI.
 */
export function parseStatQuery(raw: string): { filter: StatFilter; text: string } {
  const filter: StatFilter = {};
  STAT_TOKEN_RE.lastIndex = 0;

  const text = raw.replace(STAT_TOKEN_RE, (_match, keyRaw: string, op: string, valueRaw: string) => {
    const key = keyRaw.toLowerCase() === "lvl" ? "level" : (keyRaw.toLowerCase() as "cr" | "ac" | "hp" | "level");
    const value = crValue(valueRaw);
    const range: Range = filter[key] ?? {};
    if (op === ">") range.min = value + (key === "cr" ? 0.001 : 1);
    else if (op === ">=") range.min = value;
    else if (op === "<") range.max = value - (key === "cr" ? 0.001 : 1);
    else if (op === "<=") range.max = value;
    else { range.min = value; range.max = value; }
    filter[key] = range;
    return " ";
  });

  return { filter, text: text.trim() };
}

/** Ranks decision flows against the query, using the same token overlap. */
export function searchFlows(rawQuery: string, flows: Flow[], limit = 3): Flow[] {
  const query = normalize(rawQuery);
  if (query.length < 3) return [];
  const asked = contentTokens(query);
  if (!asked.length) return [];

  const scored = flows.map((flow) => {
    const haystack = new Set([
      ...contentTokens(flow.title),
      ...contentTokens(flow.prompt),
      ...flow.triggers.flatMap((t) => contentTokens(t)),
    ]);
    const exact = flow.triggers.some((t) => normalize(t) === query) ? 1 : 0;
    const overlap = asked.filter((t) => haystack.has(t)).length / asked.length;
    return { flow, score: exact + overlap };
  });

  return scored
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.flow);
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
