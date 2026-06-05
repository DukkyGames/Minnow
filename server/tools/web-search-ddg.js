/**
 * DuckDuckGo HTML search helpers — classify responses and parse result markup.
 */

import {
  formatSearchResults,
  normalizeSearchResults,
} from './search-result.js';

const DDG_MAX_SNIPPETS = 8;

/** User-Agent shared with fetch_web_content / DDG HTML search. */
export const DDG_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Strip HTML tags from a snippet of DDG result HTML. */
function stripHtml(fragment) {
  return String(fragment)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify DuckDuckGo HTML search responses.
 * @param {number} status HTTP status from DDG
 * @param {string} html Response body
 * @returns {'challenge' | 'results' | 'empty'}
 */
export function classifyDdgHtml(status, html) {
  const body = String(html ?? '');
  const lower = body.toLowerCase();

  if (status === 202) {
    return 'challenge';
  }
  if (lower.includes('anomaly-modal')) {
    return 'challenge';
  }
  if (lower.includes('bots use duckduckgo')) {
    return 'challenge';
  }
  if (/action\s*=\s*["'][^"']*anomaly\.js/i.test(body)) {
    return 'challenge';
  }

  const blocks = body.split(/class="result\s/);
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (/class="result__a"/i.test(block)) {
      return 'results';
    }
  }

  return 'empty';
}

/**
 * Parse DDG HTML into structured search rows.
 * @param {string} html
 * @returns {import('./search-result.js').SearchResult[]}
 */
export function parseDdgHtmlStructured(html) {
  const blocks = String(html).split(/class="result\s/);
  const results = [];

  for (let i = 1; i < blocks.length && results.length < DDG_MAX_SNIPPETS; i += 1) {
    const block = blocks[i];
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) {
      continue;
    }
    const href = titleMatch[1];
    const title = stripHtml(titleMatch[2]);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    results.push({ title, url: href, snippet });
  }

  return normalizeSearchResults(results);
}

/**
 * Parse DDG HTML into numbered result lines (titles, URLs, snippets).
 * @param {string} html
 * @param {string} query
 * @returns {string[]}
 */
export function parseDdgHtmlResults(html, query) {
  const structured = parseDdgHtmlStructured(html);
  if (!structured.length) {
    return [];
  }
  const text = formatSearchResults('DuckDuckGo', query, structured);
  return text
    .replace(/^DuckDuckGo search results for "[^"]*":\n\n/, '')
    .split('\n\n');
}

/**
 * Format structured DDG rows for the model.
 * @param {string} query
 * @param {import('./search-result.js').SearchResult[]} results
 * @returns {string}
 */
export function formatDdgSearchResults(query, results) {
  return formatSearchResults('DuckDuckGo', query, results);
}

/**
 * Run DuckDuckGo HTML search and return structured rows.
 * @param {string} query
 * @returns {Promise<{ results: import('./search-result.js').SearchResult[]; error?: string }>}
 */
export async function searchDdgStructured(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': DDG_USER_AGENT,
      Accept: 'text/html',
    },
  });

  const html = await response.text();
  const classification = classifyDdgHtml(response.status, html);

  if (classification === 'challenge') {
    return { results: [], error: DDG_BOT_CHALLENGE_MESSAGE };
  }

  if (!response.ok) {
    return { results: [], error: `Error: DuckDuckGo returned HTTP ${response.status}` };
  }

  const results = parseDdgHtmlStructured(html);
  if (!results.length) {
    return { results: [], error: `No DuckDuckGo results found for: ${query}` };
  }

  return { results };
}

/** User-facing message when DDG serves a bot challenge instead of results. */
export const DDG_BOT_CHALLENGE_MESSAGE =
  'Error: DuckDuckGo blocked automated access (bot challenge). Add a Brave or Tavily API key in Settings → Tools, choose that provider, and try again.';

export { DDG_MAX_SNIPPETS };
