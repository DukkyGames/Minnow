import {
  fetchUrlText,
  rankWebContentByQuery,
  truncateUtf8,
  WEB_TEXT_MAX_BYTES,
} from '../../src/lib/fetch-web-content.mjs';

import { getOutputCapPolicy } from './output-cap.js';

export const DEEP_READ_PAGE_LIMIT = 3;

export const DEEP_READ_EXCERPTS_PER_PAGE = 4;

/**
 * @typedef {import('./search-result.js').SearchResult} SearchResult
 * @typedef {{ result: SearchResult; excerpts: string[]; error?: string }} EnrichedPage
 */

/**
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
      const policy = getOutputCapPolicy();
      const capped = policy.applyResultCap ? truncateUtf8(text, WEB_TEXT_MAX_BYTES) : text;
      return { result, excerpts: rankWebContentByQuery(capped, query, excerptsPerPage) };
    }),
  );
}

/**
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
 * @param {string} query
 * @param {SearchResult[]} results
 * @param {string} formatted
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
