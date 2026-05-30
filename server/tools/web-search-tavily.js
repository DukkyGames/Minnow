/**
 * Tavily Search API — server-side web_search_tavily handler.
 */

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_MAX_RESULTS = 8;

/**
 * Format Tavily JSON results for the model (matches Brave/DDG text shape).
 * @param {string} query
 * @param {Array<{ title?: string; url?: string; content?: string }>} results
 * @returns {string}
 */
export function formatTavilySearchResults(query, results) {
  if (!results.length) {
    return `No Tavily results found for: ${query}`;
  }

  const lines = results.map((row, index) => {
    const title = String(row.title ?? '(no title)').trim();
    const url = String(row.url ?? '').trim();
    const content = String(row.content ?? '').trim();
    return `${index + 1}. ${title}\n   ${url}\n   ${content}`;
  });

  return `Tavily search results for "${query}":\n\n${lines.join('\n\n')}`;
}

/**
 * Run Tavily search with the given API key.
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function runTavilySearch(query, apiKey) {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: TAVILY_MAX_RESULTS,
      search_depth: 'basic',
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    return `Error: Tavily returned invalid JSON (HTTP ${response.status})`;
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && payload.error
        ? String(payload.error)
        : `HTTP ${response.status}`;
    return `Error: Tavily search failed (${detail})`;
  }

  const results = Array.isArray(payload?.results) ? payload.results : [];
  return formatTavilySearchResults(query, results);
}
