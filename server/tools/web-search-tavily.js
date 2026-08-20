/**
 * Tavily Search API — server-side web_search_tavily handler.
 */

import {
  applyRelevanceGuard,
  formatSearchResults,
  normalizeSearchResults,
} from './search-result.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_MAX_RESULTS = 8;

/**
 * Map Tavily API rows to structured search results.
 * @param {Array<{ title?: string; url?: string; content?: string }>} rows
 * @returns {import('./search-result.js').SearchResult[]}
 */
export function mapTavilyResults(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return normalizeSearchResults(
    rows.map((row) => ({
      title: row.title,
      url: row.url,
      snippet: row.content,
    })),
  );
}

/**
 * Format Tavily JSON results for the model (matches Brave/DDG text shape).
 * @param {string} query
 * @param {import('./search-result.js').SearchResult[]} results
 * @returns {string}
 */
export function formatTavilySearchResults(query, results) {
  return formatSearchResults('Tavily', query, results);
}

/**
 * Run Tavily search and return structured rows.
 * @param {string} query
 * @param {string} apiKey
 * @param {number} [maxResults]
 * @returns {Promise<{ results: import('./search-result.js').SearchResult[]; error?: string }>}
 */
export async function searchTavilyStructured(query, apiKey, maxResults = TAVILY_MAX_RESULTS) {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: 'basic',
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      results: [],
      error: `Error: Tavily returned invalid JSON (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && payload.error
        ? String(payload.error)
        : `HTTP ${response.status}`;
    return { results: [], error: `Error: Tavily search failed (${detail})` };
  }

  const results = mapTavilyResults(payload?.results);
  if (!results.length) {
    return { results: [], error: `No Tavily results found for: ${query}` };
  }

  return applyRelevanceGuard('Tavily', query, results);
}

/**
 * Run Tavily search with the given API key.
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function runTavilySearch(query, apiKey) {
  const { results, error } = await searchTavilyStructured(query, apiKey);
  if (error) {
    return error;
  }
  return formatTavilySearchResults(query, results);
}
