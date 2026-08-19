/**
 * Brave Search API — server-side structured search for the research provider chain.
 */

import {
  applyRelevanceGuard,
  formatSearchResults,
  normalizeSearchResults,
} from './search-result.js';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_DEFAULT_COUNT = 10;

/**
 * Map Brave web results to structured rows.
 * @param {unknown} payload
 * @returns {import('./search-result.js').SearchResult[]}
 */
export function mapBraveResults(payload) {
  const web = payload && typeof payload === 'object' ? payload.web : null;
  const rows = web && Array.isArray(web.results) ? web.results : [];
  return normalizeSearchResults(
    rows.map((row) => ({
      title: row?.title,
      url: row?.url,
      snippet: row?.description ?? row?.snippet,
    })),
  );
}

/**
 * @param {string} query
 * @param {import('./search-result.js').SearchResult[]} results
 * @returns {string}
 */
export function formatBraveSearchResults(query, results) {
  return formatSearchResults('Brave', query, results);
}

/**
 * Run Brave web search and return structured rows.
 * @param {string} query
 * @param {string} apiKey
 * @param {number} [count]
 * @returns {Promise<{ results: import('./search-result.js').SearchResult[]; error?: string }>}
 */
export async function searchBraveStructured(query, apiKey, count = BRAVE_DEFAULT_COUNT) {
  const safeCount = Math.min(Math.max(Number(count) || BRAVE_DEFAULT_COUNT, 1), 20);
  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${safeCount}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      results: [],
      error: `Error: Brave returned invalid JSON (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && payload.message
        ? String(payload.message)
        : `HTTP ${response.status}`;
    return { results: [], error: `Error: Brave search failed (${detail})` };
  }

  const results = mapBraveResults(payload);
  if (!results.length) {
    return { results: [], error: `No Brave results found for: ${query}` };
  }

  return applyRelevanceGuard('Brave', query, results);
}

/**
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function runBraveSearch(query, apiKey) {
  const { results, error } = await searchBraveStructured(query, apiKey);
  if (error) {
    return error;
  }
  return formatBraveSearchResults(query, results);
}
