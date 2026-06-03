/**
 * Pure ranking for settings finder queries.
 */

import type { SettingsSearchEntry } from './settings-search-types';

const MAX_RESULTS = 12;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function tokenize(query: string): string[] {
  return normalizeQuery(query).split(/\s+/).filter(Boolean);
}

function scoreToken(token: string, entry: SettingsSearchEntry): number {
  const label = entry.label.toLowerCase();
  const id = entry.id.toLowerCase();
  const keywords = (entry.keywords ?? []).map((k) => k.toLowerCase());
  const haystack = [label, id, ...keywords];

  if (label === token) return 1000;
  if (label.startsWith(token)) return 850;
  if (label.includes(token)) return 700;

  for (const kw of keywords) {
    if (kw === token) return 650;
    if (kw.startsWith(token)) return 550;
    if (kw.includes(token)) return 450;
  }

  if (id.includes(token)) return 350;

  for (const text of haystack) {
    if (text.includes(token)) return 250;
  }

  return 0;
}

function scoreEntry(query: string, entry: SettingsSearchEntry): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    const part = scoreToken(token, entry);
    if (part === 0) return 0;
    total += part;
  }
  return total;
}

/** Rank entries: exact label prefix beats substring; all tokens must match somewhere. */
export function rankSettingsSearch(
  query: string,
  entries: SettingsSearchEntry[],
): SettingsSearchEntry[] {
  const trimmed = normalizeQuery(query);
  if (!trimmed) return [];

  return entries
    .map((entry) => ({ entry, score: scoreEntry(trimmed, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const kindOrder =
        (a.entry.kind === 'section' ? 1 : 0) - (b.entry.kind === 'section' ? 1 : 0);
      if (kindOrder !== 0) return kindOrder;
      return a.entry.label.localeCompare(b.entry.label);
    })
    .map((row) => row.entry)
    .slice(0, MAX_RESULTS);
}
