/**
 * Shared web search result shape for structured providers and text formatters.
 * @typedef {{ title: string; url: string; snippet: string }} SearchResult
 */

/**
 * @param {SearchResult[]} results
 * @returns {SearchResult[]}
 */
export function normalizeSearchResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  const out = [];
  for (const row of results) {
    const title = String(row?.title ?? '(no title)').trim();
    const url = String(row?.url ?? '').trim();
    const snippet = String(row?.snippet ?? '').trim();
    if (!url) {
      continue;
    }
    out.push({ title, url, snippet });
  }
  return out;
}

/**
 * Format structured rows for model-facing tool output.
 * @param {string} providerLabel
 * @param {string} query
 * @param {SearchResult[]} results
 * @returns {string}
 */
export function formatSearchResults(providerLabel, query, results) {
  const rows = normalizeSearchResults(results);
  if (!rows.length) {
    return `No ${providerLabel} results found for: ${query}`;
  }

  const lines = rows.map((row, index) => {
    return `${index + 1}. ${row.title}\n   ${row.url}\n   ${row.snippet}`;
  });

  return `${providerLabel} search results for "${query}":\n\n${lines.join('\n\n')}`;
}
