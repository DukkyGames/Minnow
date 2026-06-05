/**
 * SearXNG JSON search — server-side web_search_searxng and research provider chain.
 */

import {
  formatSearchResults,
  normalizeSearchResults,
} from './search-result.js';

const SEARXNG_DEFAULT_COUNT = 10;

/**
 * Map SearXNG JSON `results[]` to structured rows (`content` → snippet).
 * @param {unknown} payload
 * @param {number} [maxResults]
 * @returns {import('./search-result.js').SearchResult[]}
 */
export function mapSearxngResults(payload, maxResults = SEARXNG_DEFAULT_COUNT) {
  const rows = payload && typeof payload === 'object' && Array.isArray(payload.results)
    ? payload.results
    : [];
  const limited = rows.slice(0, Math.max(1, maxResults));
  return normalizeSearchResults(
    limited.map((row) => ({
      title: row?.title,
      url: row?.url,
      snippet: row?.content ?? row?.snippet,
    })),
  );
}

/**
 * @param {string} query
 * @param {import('./search-result.js').SearchResult[]} results
 * @returns {string}
 */
export function formatSearxngSearchResults(query, results) {
  return formatSearchResults('SearXNG', query, results);
}

/**
 * Run SearXNG JSON search.
 * @param {string} query
 * @param {string} searxngBaseUrl
 * @param {number} [count]
 * @returns {Promise<{ results: import('./search-result.js').SearchResult[]; error?: string }>}
 */
export async function searchSearxngStructured(query, searxngBaseUrl, count = SEARXNG_DEFAULT_COUNT) {
  const base = String(searxngBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    return { results: [], error: 'Error: SearXNG URL not configured.' };
  }

  const safeCount = Math.min(Math.max(Number(count) || SEARXNG_DEFAULT_COUNT, 1), 30);
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { results: [], error: `Error: SearXNG request failed (${message})` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      results: [],
      error: `Error: SearXNG returned invalid JSON (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    return { results: [], error: `Error: SearXNG returned HTTP ${response.status}` };
  }

  const results = mapSearxngResults(payload, safeCount);
  if (!results.length) {
    return { results: [], error: `No SearXNG results found for: ${query}` };
  }

  return { results };
}

/**
 * @param {string} query
 * @param {string} searxngBaseUrl
 * @returns {Promise<string>}
 */
export async function runSearxngSearch(query, searxngBaseUrl) {
  const { results, error } = await searchSearxngStructured(query, searxngBaseUrl);
  if (error) {
    return error;
  }
  return formatSearxngSearchResults(query, results);
}
