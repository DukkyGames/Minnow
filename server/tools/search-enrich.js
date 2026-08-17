/**
 * Search result enrichment — fetch the top hits and return ranked excerpts.
 *
 * Result snippets are one line each and frequently too thin to answer from, which costs
 * the model a second round-trip through fetch_web_content anyway. This pulls the top few
 * pages and reuses the rag_web_content ranker so one call can be enough.
 */

import {
  fetchUrlText,
  rankWebContentByQuery,
  truncateUtf8,
  WEB_TEXT_MAX_BYTES,
} from '../../src/lib/fetch-web-content.mjs';

/** Pages fetched per enriched search. Kept small — each is a network round-trip. */
export const DEEP_READ_PAGE_LIMIT = 3;

/** Ranked excerpts kept per page. */
export const DEEP_READ_EXCERPTS_PER_PAGE = 4;

/**
 * @typedef {import('./search-result.js').SearchResult} SearchResult
 * @typedef {{ result: SearchResult; excerpts: string[]; error?: string }} EnrichedPage
 */

/**
 * Fetch and rank the top results.
 *
 * Fetches run in parallel and never reject — a page that 404s or times out is reported
 * inline rather than failing the search.
 * @param {string} query
 * @param {SearchResult[]} results
 * @param {{ pageLimit?: number; excerptsPerPage?: number }} [opts]
 * @returns {Promise<EnrichedPage[]>}
 */
export async function fetchResultExcerpts(query, results, opts = {}) {
  const pageLimit = Math.min(Math.max(opts.pageLimit ?? DEEP_READ_PAGE_LIMIT, 1), 5);
  const excerptsPerPage = Math.max(opts.excerptsPerPage ?? DEEP_READ_EXCERPTS_PER_PAGE, 1);
  const targets = results.slice(0, pageLimit);

  return Promise.all(
    targets.map(async (result) => {
      let text;
      try {
        text = await fetchUrlText(result.url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { result, excerpts: [], error: `fetch failed (${message})` };
      }
      if (typeof text !== 'string' || text.startsWith('Error:')) {
        return { result, excerpts: [], error: text || 'fetch failed' };
      }
      const capped = truncateUtf8(text, WEB_TEXT_MAX_BYTES);
      return { result, excerpts: rankWebContentByQuery(capped, query, excerptsPerPage) };
    }),
  );
}

/**
 * Render enriched pages as a block appended below the result list.
 * @param {string} query
 * @param {EnrichedPage[]} pages
 * @returns {string}
 */
export function formatResultExcerpts(query, pages) {
  const blocks = [];
  for (const [index, page] of pages.entries()) {
    const header = `[${index + 1}] ${page.result.title}\n    ${page.result.url}`;
    if (page.error) {
      blocks.push(`${header}\n    (could not read page: ${page.error})`);
      continue;
    }
    if (!page.excerpts.length) {
      blocks.push(`${header}\n    (no passages matched the query)`);
      continue;
    }
    const body = page.excerpts.map((excerpt) => `    - ${excerpt}`).join('\n');
    blocks.push(`${header}\n${body}`);
  }

  if (!blocks.length) {
    return '';
  }
  return `\n\nPage excerpts for "${query}":\n\n${blocks.join('\n\n')}`;
}

/**
 * Search-result text with ranked page excerpts appended.
 * @param {string} query
 * @param {SearchResult[]} results
 * @param {string} formatted Already-formatted result listing.
 * @param {{ pageLimit?: number; excerptsPerPage?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function appendResultExcerpts(query, results, formatted, opts = {}) {
  if (!results.length) {
    return formatted;
  }
  const pages = await fetchResultExcerpts(query, results, opts);
  return `${formatted}${formatResultExcerpts(query, pages)}`;
}
