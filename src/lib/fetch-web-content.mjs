/**
 * Shared HTTP fetch + HTML strip + truncation for fetch_web_content / rag_web_content.
 * Used by the browser executor and the Node tool server (BUG-011).
 */

/** Max plain-text bytes returned from fetched web pages. */
export const WEB_TEXT_MAX_BYTES = 24576;

/** Default number of ranked excerpts returned by rag_web_content. */
export const WEB_RAG_EXCERPT_LIMIT = 16;

/** User-Agent for server-side page fetch (align with web_search_ddg). */
export const DEFAULT_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Validates an http(s) URL string.
 * @param {string} urlString
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
export function validateHttpUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, error: `Error: invalid URL "${urlString}"` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Error: only http and https URLs are supported' };
  }

  return { ok: true, url: parsed };
}

/**
 * Strips script/style blocks, tags, and entities; collapses whitespace to plain text.
 * @param {string} html
 * @returns {string}
 */
export function stripHtmlToPlainText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Truncates UTF-8 text to maxBytes without splitting multibyte code points.
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
export function truncateUtf8(text, maxBytes) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }

  const decoder = new TextDecoder();
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }

  const truncated = decoder.decode(bytes.slice(0, end));
  return `${truncated}\n\n[truncated to ${maxBytes} bytes]`;
}

/**
 * Tokenize a query into lowercase terms (length >= 2).
 * @param {string} query
 * @returns {string[]}
 */
function queryTerms(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\w]/g, ''))
    .filter((t) => t.length > 1);
}

/**
 * Score one text unit by query term overlap.
 * @param {string} unit
 * @param {string[]} terms
 * @returns {number}
 */
function scoreUnitByTerms(unit, terms) {
  const lower = unit.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Scores sentences by query term overlap and returns the top matches.
 * @param {string} text
 * @param {string} query
 * @param {number} limit
 * @returns {string[]}
 */
export function rankSentencesByQuery(text, query, limit) {
  const terms = queryTerms(query);

  if (terms.length === 0) {
    return [];
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const scored = sentences
    .map((sentence) => ({
      sentence,
      score: scoreUnitByTerms(sentence, terms),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((row) => row.sentence);
}

/**
 * Scores paragraphs (blank-line separated) by query term overlap.
 * @param {string} text
 * @param {string} query
 * @param {number} limit
 * @returns {string[]}
 */
export function rankParagraphsByQuery(text, query, limit) {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40);

  const scored = paragraphs
    .map((paragraph) => ({
      unit: paragraph,
      score: scoreUnitByTerms(paragraph, terms),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((row) => row.unit);
}

/**
 * Rank sentences and paragraphs together for denser web RAG excerpts.
 * @param {string} text
 * @param {string} query
 * @param {number} [limit]
 * @returns {string[]}
 */
export function rankWebContentByQuery(text, query, limit = WEB_RAG_EXCERPT_LIMIT) {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const candidates = [];
  const seen = new Set();

  for (const sentence of rankSentencesByQuery(text, query, limit)) {
    const key = sentence.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ unit: sentence, score: scoreUnitByTerms(sentence, terms) });
  }

  for (const paragraph of rankParagraphsByQuery(text, query, limit)) {
    const key = paragraph.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ unit: paragraph, score: scoreUnitByTerms(paragraph, terms) });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.unit);
}

/** Default excerpt length for query-relevant memory/wiki injection. */
export const MEMORY_EXCERPT_MAX_CHARS = 500;

/**
 * Pick the best query-matching excerpt from a wiki page body.
 * @param {string} body
 * @param {string} [query]
 * @param {number} [maxLen]
 * @returns {string}
 */
export function selectQueryRelevantExcerpt(body, query = '', maxLen = MEMORY_EXCERPT_MAX_CHARS) {
  const text = String(body ?? '').trim();
  if (!text) return '';

  const terms = queryTerms(query);
  let best = '';

  if (terms.length > 0) {
    const sections = text
      .split(/(?=^##\s)/m)
      .map((s) => s.trim())
      .filter(Boolean);

    const units =
      sections.length > 1
        ? sections
        : text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

    let bestScore = 0;
    for (const unit of units) {
      const score = scoreUnitByTerms(unit, terms);
      if (score > bestScore) {
        bestScore = score;
        best = unit;
      }
    }
  }

  if (!best) {
    best =
      text
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? '';
  }

  const oneLine = best.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

/**
 * Builds a user-visible network error for fetch failures.
 * @param {string} url
 * @param {unknown} err
 * @param {{ suggestNpmStart?: boolean }} [options]
 * @returns {string}
 */
export function formatFetchNetworkError(url, err, options = {}) {
  const message = err instanceof Error ? err.message : String(err);
  const corsHint =
    /failed to fetch|fetch failed|networkerror/i.test(message)
      ? ' The site may block cross-origin requests (CORS).'
      : '';
  const startHint = options.suggestNpmStart
    ? ' Open Minnow for in-app page fetch (avoids browser CORS limits).'
    : '';
  return `Error: fetch failed for ${url} (${message}).${corsHint}${startHint}`;
}

/**
 * Fetches http(s) URL and returns stripped plain text or an error string.
 * @param {string} urlString
 * @param {{ userAgent?: string, suggestNpmStart?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function fetchUrlText(urlString, options = {}) {
  const validated = validateHttpUrl(urlString);
  if (!validated.ok) {
    return validated.error;
  }

  const { url } = validated;
  const userAgent = options.userAgent ?? DEFAULT_FETCH_USER_AGENT;

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
  } catch (err) {
    return formatFetchNetworkError(url.toString(), err, {
      suggestNpmStart: options.suggestNpmStart,
    });
  }

  if (!response.ok) {
    return `Error: HTTP ${response.status} ${response.statusText} for ${url.toString()}`;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();

  if (contentType.includes('text/html') || body.trimStart().startsWith('<')) {
    return stripHtmlToPlainText(body);
  }

  return body;
}
