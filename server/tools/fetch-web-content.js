/**
 * Server-side fetch_web_content and rag_web_content (BUG-011 / BUG-015).
 * Node fetch avoids browser CORS; HTML strip/truncate shared with browser executor.
 */

import {
  fetchUrlText,
  rankWebContentByQuery,
  truncateUtf8,
  WEB_RAG_EXCERPT_LIMIT,
  WEB_TEXT_MAX_BYTES,
} from '../../src/lib/fetch-web-content.mjs';
import { wrapUntrusted } from '../security/untrusted.js';
import { getOutputCapPolicy } from './output-cap.js';

/** Apply the product web-text byte cap unless this call skipped result caps. */
function capFetchedWebText(text) {
  const policy = getOutputCapPolicy();
  if (!policy.applyResultCap) return text;
  return truncateUtf8(text, WEB_TEXT_MAX_BYTES);
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolFetchWebContent(args) {
  const url = typeof args?.url === 'string' ? args.url.trim() : '';
  if (!url) {
    return 'Error: "url" is required';
  }

  const fetchResult = await fetchUrlText(url);
  if (fetchResult.startsWith('Error:')) {
    return fetchResult;
  }

  const text = capFetchedWebText(fetchResult);
  return wrapUntrusted(text, { source: `web:${url}` });
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolRagWebContent(args) {
  const url = typeof args?.url === 'string' ? args.url.trim() : '';
  const query = typeof args?.query === 'string' ? args.query.trim() : '';

  if (!url) {
    return 'Error: "url" is required';
  }
  if (!query) {
    return 'Error: "query" is required';
  }

  const fetchResult = await fetchUrlText(url);
  if (fetchResult.startsWith('Error:')) {
    return fetchResult;
  }

  const capped = capFetchedWebText(fetchResult);
  const snippets = rankWebContentByQuery(capped, query, WEB_RAG_EXCERPT_LIMIT);

  if (snippets.length === 0) {
    return `No relevant sentences found on ${url} for query: ${query}`;
  }

  const header = `Relevant excerpts from ${url} for "${query}":\n\n`;
  const body = header + snippets.map((s, i) => `${i + 1}. ${s}`).join('\n\n');
  return wrapUntrusted(body, { source: `web-rag:${url}` });
}
