/**
 * DuckDuckGo HTML search helpers — classify responses and parse result markup.
 */

const DDG_MAX_SNIPPETS = 8;

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
 * Parse DDG HTML into numbered result lines (titles, URLs, snippets).
 * @param {string} html
 * @param {string} query
 * @returns {string[]}
 */
export function parseDdgHtmlResults(html, query) {
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
    results.push(`${results.length + 1}. ${title}\n   ${href}\n   ${snippet}`);
  }

  return results;
}

/** User-facing message when DDG serves a bot challenge instead of results. */
export const DDG_BOT_CHALLENGE_MESSAGE =
  'Error: DuckDuckGo blocked automated access (bot challenge). Add a Brave or Tavily API key in Settings → Tools, choose that provider, and try again.';

export { DDG_MAX_SNIPPETS };
