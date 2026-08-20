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
 * Words carried by almost every query; they match everything and would mask a decoy.
 */
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'are', 'how', 'what', 'why', 'when', 'where', 'does',
  'did', 'can', 'from', 'that', 'this', 'you', 'your', 'has', 'have', 'was', 'were',
  'not', 'but', 'all', 'any', 'its', 'use', 'using', 'get', 'set', 'best', 'vs',
]);

/**
 * Distinctive lowercase tokens from a query.
 *
 * Keeps `+ # . -` so `c++`, `c#`, `node.js` and `happy-dom` survive; drops tokens
 * shorter than three characters (version numbers, articles) and stopwords.
 * @param {string} query
 * @returns {string[]}
 */
export function tokenizeQuery(query) {
  const cleaned = String(query ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-]+/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token));
  return [...new Set(tokens)];
}

/**
 * Fraction of results mentioning at least one distinctive query token.
 * @param {string} query
 * @param {SearchResult[]} results
 * @returns {number} 0..1, or 1 when there is nothing meaningful to judge
 */
export function resultSetCoverage(query, results) {
  const tokens = tokenizeQuery(query);
  const rows = normalizeSearchResults(results);
  if (!tokens.length || !rows.length) {
    return 1;
  }

  let hits = 0;
  for (const row of rows) {
    const haystack = `${row.title} ${row.url} ${row.snippet}`.toLowerCase();
    if (tokens.some((token) => haystack.includes(token))) {
      hits += 1;
    }
  }
  return hits / rows.length;
}

/**
 * Coverage at or above which a result set is trusted wholesale.
 *
 * Below it the set is treated as contaminated and filtered row by row. Measured against
 * live multi-engine result sets: healthy sets scored 0.75–1.00, sets carrying Bing decoy
 * rows scored 0.00–0.35. Filtering rather than discarding matters because a mixed set
 * (good Stack Overflow rows + decoy Bing rows) can score as low as 0.23 — dropping it
 * whole would throw away the good rows with the bad.
 */
export const HEALTHY_COVERAGE_THRESHOLD = 0.6;

/** Result sets smaller than this are too thin to judge — a narrow query can legitimately return one hit. */
const MIN_RESULTS_TO_JUDGE = 3;

/** True when a single row mentions any distinctive query token. */
function rowMatchesQuery(row, tokens) {
  const haystack = `${row.title} ${row.url} ${row.snippet}`.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

/**
 * True when nothing in a result set relates to the query.
 *
 * Used to reject poisoned cache entries. Deliberately strict: a set with even one
 * relevant row is salvageable by {@link applyRelevanceGuard} and should not be thrown out.
 * @param {string} query
 * @param {SearchResult[]} results
 * @returns {boolean}
 */
export function looksUnrelated(query, results) {
  const rows = normalizeSearchResults(results);
  const tokens = tokenizeQuery(query);
  if (rows.length < MIN_RESULTS_TO_JUDGE || !tokens.length) {
    return false;
  }
  return !rows.some((row) => rowMatchesQuery(row, tokens));
}

/**
 * Strip results that do not answer the query.
 *
 * Guards against providers that fail *open*: Bing serves decoy SERPs (HTTP 200, correct
 * page title, well-formed results belonging to entirely different queries) rather than an
 * error or an empty page, so result count alone cannot detect the failure.
 *
 * A healthy set is passed through untouched — filtering there would drop results that are
 * relevant but phrased differently from the query. A contaminated set is filtered down to
 * its matching rows, and only a set with nothing left fails the provider so the caller
 * falls through to the next one.
 * @param {string} providerLabel
 * @param {string} query
 * @param {SearchResult[]} results
 * @returns {{ results: SearchResult[]; error?: string }}
 */
export function applyRelevanceGuard(providerLabel, query, results) {
  const rows = normalizeSearchResults(results);
  const tokens = tokenizeQuery(query);
  if (rows.length < MIN_RESULTS_TO_JUDGE || !tokens.length) {
    return { results: rows };
  }
  if (resultSetCoverage(query, rows) >= HEALTHY_COVERAGE_THRESHOLD) {
    return { results: rows };
  }

  const kept = rows.filter((row) => rowMatchesQuery(row, tokens));
  if (!kept.length) {
    return {
      results: [],
      error:
        `Error: ${providerLabel} returned ${rows.length} results unrelated to "${query}" ` +
        '(likely an anti-scraping decoy page); discarded.',
    };
  }
  return { results: kept };
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
