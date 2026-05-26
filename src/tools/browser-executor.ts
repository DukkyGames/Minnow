/**
 * Browser-native tool execution (SA-3).
 * All handlers return human-readable strings; failures use "Error: …" prefixes.
 *
 * web_search: uses Brave when `api_key` is present; without a key, returns a message
 * so the client router (SA-5) can fall back to server `web_search_ddg`.
 *
 * fetch_web_content / rag_web_content: client routes to the server when `npm start`
 * is up (BUG-011); this executor is the browser fallback (CORS-bound).
 *
 * Full browser automation (navigate, snapshot, screenshot) lives in server CDP tools
 * (`browser_*` via `npm start` / POST /api/tools) — not in this executor.
 */

import {
  fetchUrlText,
  rankSentencesByQuery,
  truncateUtf8,
  WEB_TEXT_MAX_BYTES,
} from '../lib/fetch-web-content.mjs';

/** Allowed characters for safe math evaluation (digits, operators, whitespace, commas). */
const SAFE_CALC_CHARS = /^[0-9+\-*/().%\s,]+$/;

/** Allowed Math.* identifiers inside calculate expressions. */
const SAFE_MATH_IDENT = /^Math\.(abs|ceil|floor|round|sqrt|pow|min|max|log|exp|sin|cos|tan|PI|E)$/;

/**
 * Routes a tool name to the matching browser handler.
 * Unknown tools return a clear error string (never throw to callers).
 */
export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  try {
    switch (name) {
      case 'get_datetime':
        return toolGetDatetime();
      case 'calculate':
        return toolCalculate(args);
      case 'web_search':
        return await toolWebSearch(args);
      case 'wikipedia_search':
        return await toolWikipediaSearch(args);
      case 'fetch_web_content':
        return await toolFetchWebContent(args);
      case 'rag_web_content':
        return await toolRagWebContent(args);
      case 'read_clipboard':
        return await toolReadClipboard();
      case 'write_clipboard':
        return await toolWriteClipboard(args);
      case 'get_system_info':
        return toolGetSystemInfo();
      default:
        return `Error: unknown browser tool "${name}"`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

/** Current date/time as ISO 8601. */
function toolGetDatetime(): string {
  return new Date().toISOString();
}

/**
 * Evaluates a math expression via `Math` only (whitelist + new Function).
 * Expected: "Error: …" for invalid input; numeric string on success.
 */
function toolCalculate(args: Record<string, unknown>): string {
  const raw = args.expression;
  if (typeof raw !== 'string' || !raw.trim()) {
    return 'Error: "expression" is required';
  }

  const expression = raw.trim();
  if (!isSafeCalculateExpression(expression)) {
    return 'Error: expression contains disallowed characters or tokens';
  }

  try {
    const evaluate = new Function('Math', `"use strict"; return (${expression});`) as (
      math: typeof Math,
    ) => unknown;
    const result = evaluate(Math);

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return 'Error: expression did not evaluate to a finite number';
    }

    return String(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: failed to evaluate expression (${message})`;
  }
}

/** Splits expression into tokens and validates each against safe char / Math rules. */
function isSafeCalculateExpression(expression: string): boolean {
  const tokens = expression.split(/(Math\.[a-zA-Z]+)/g).filter((t) => t.length > 0);

  for (const token of tokens) {
    if (token.startsWith('Math.')) {
      if (!SAFE_MATH_IDENT.test(token)) {
        return false;
      }
      continue;
    }
    if (!SAFE_CALC_CHARS.test(token)) {
      return false;
    }
  }

  return tokens.length > 0;
}

/**
 * Brave web search when api_key is set; otherwise instructs client to use server DDG.
 */
async function toolWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = stringArg(args, 'query');
  if (!query) {
    return 'Error: "query" is required';
  }

  const apiKey =
    (typeof args.api_key === 'string' && args.api_key.trim()) ||
    (typeof args.braveApiKey === 'string' && args.braveApiKey.trim()) ||
    '';

  if (!apiKey) {
    return (
      'Error: no Brave API key provided. Save a key in tool settings or pass api_key. ' +
      'Without a key, web_search is handled by the local server (web_search_ddg via DuckDuckGo).'
    );
  }

  return searchBrave(query, apiKey);
}

/** Calls Brave Search API and formats top web results. */
async function searchBrave(query: string, apiKey: string): Promise<string> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '8');

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: Brave search request failed (${message})`;
  }

  if (!response.ok) {
    return `Error: Brave search HTTP ${response.status} ${response.statusText}`;
  }

  let data: BraveSearchResponse;
  try {
    data = (await response.json()) as BraveSearchResponse;
  } catch {
    return 'Error: Brave search returned invalid JSON';
  }

  const results = data.web?.results ?? [];
  if (results.length === 0) {
    return `No results found for: ${query}`;
  }

  const lines = results.slice(0, 8).map((item, index) => {
    const title = item.title?.trim() || '(no title)';
    const link = item.url?.trim() || '';
    const snippet = item.description?.trim() || '';
    return `${index + 1}. ${title}\n   ${link}\n   ${snippet}`;
  });

  return `Brave search results for "${query}":\n\n${lines.join('\n\n')}`;
}

/** Wikipedia opensearch (CORS-open) plus short extracts when available. */
async function toolWikipediaSearch(args: Record<string, unknown>): Promise<string> {
  const query = stringArg(args, 'query');
  if (!query) {
    return 'Error: "query" is required';
  }

  const apiUrl = new URL('https://en.wikipedia.org/w/api.php');
  apiUrl.searchParams.set('action', 'opensearch');
  apiUrl.searchParams.set('search', query);
  apiUrl.searchParams.set('limit', '5');
  apiUrl.searchParams.set('namespace', '0');
  apiUrl.searchParams.set('format', 'json');
  apiUrl.searchParams.set('origin', '*');

  let response: Response;
  try {
    response = await fetch(apiUrl.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: Wikipedia request failed (${message})`;
  }

  if (!response.ok) {
    return `Error: Wikipedia HTTP ${response.status} ${response.statusText}`;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return 'Error: Wikipedia returned invalid JSON';
  }

  if (!Array.isArray(payload) || payload.length < 4) {
    return 'Error: unexpected Wikipedia response shape';
  }

  const titles = payload[1] as string[];
  const descriptions = payload[2] as string[];
  const urls = payload[3] as string[];

  if (!titles.length) {
    return `No Wikipedia articles found for: ${query}`;
  }

  const blocks: string[] = [];
  for (let i = 0; i < titles.length; i += 1) {
    const title = titles[i] ?? '';
    const desc = descriptions[i]?.trim() || '(no description)';
    const pageUrl = urls[i] ?? '';
    blocks.push(`${i + 1}. ${title}\n   ${pageUrl}\n   ${desc}`);
  }

  return `Wikipedia results for "${query}":\n\n${blocks.join('\n\n')}`;
}

/** Fetches a URL, strips HTML, caps output at ~8KB. Browser fallback when server is down (CORS). */
async function toolFetchWebContent(args: Record<string, unknown>): Promise<string> {
  const url = stringArg(args, 'url');
  if (!url) {
    return 'Error: "url" is required';
  }

  const fetchResult = await fetchUrlText(url, { suggestNpmStart: true });
  if (fetchResult.startsWith('Error:')) {
    return fetchResult;
  }

  return truncateUtf8(fetchResult, WEB_TEXT_MAX_BYTES);
}

/** Fetches a page and returns sentences most relevant to the query. */
async function toolRagWebContent(args: Record<string, unknown>): Promise<string> {
  const url = stringArg(args, 'url');
  const query = stringArg(args, 'query');

  if (!url) {
    return 'Error: "url" is required';
  }
  if (!query) {
    return 'Error: "query" is required';
  }

  const fetchResult = await fetchUrlText(url, { suggestNpmStart: true });
  if (fetchResult.startsWith('Error:')) {
    return fetchResult;
  }

  const capped = truncateUtf8(fetchResult, WEB_TEXT_MAX_BYTES);
  const snippets = rankSentencesByQuery(capped, query, 8);

  if (snippets.length === 0) {
    return `No relevant sentences found on ${url} for query: ${query}`;
  }

  const header = `Relevant excerpts from ${url} for "${query}":\n\n`;
  return header + snippets.map((s, i) => `${i + 1}. ${s}`).join('\n\n');
}

/** Reads plain text from the clipboard (permission may be required). */
async function toolReadClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) {
    return 'Error: Clipboard API is not available in this browser';
  }

  try {
    const text = await navigator.clipboard.readText();
    return text.length > 0 ? text : '(clipboard is empty)';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: could not read clipboard (${message}). Grant clipboard permission if prompted.`;
  }
}

/** Writes plain text to the clipboard. */
async function toolWriteClipboard(args: Record<string, unknown>): Promise<string> {
  const text = args.text;
  if (typeof text !== 'string') {
    return 'Error: "text" is required';
  }

  if (!navigator.clipboard?.writeText) {
    return 'Error: Clipboard API is not available in this browser';
  }

  try {
    await navigator.clipboard.writeText(text);
    return `Copied ${text.length} character(s) to the clipboard`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: could not write clipboard (${message})`;
  }
}

/** Serializes navigator and screen info as JSON for the model. */
function toolGetSystemInfo(): string {
  const nav = navigator;
  const info: Record<string, unknown> = {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    languages: nav.languages,
    cookieEnabled: nav.cookieEnabled,
    onLine: nav.onLine,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: 'deviceMemory' in nav ? (nav as Navigator & { deviceMemory?: number }).deviceMemory : undefined,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    },
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  };

  return JSON.stringify(info, null, 2);
}

/** Reads a trimmed string argument or returns empty string if missing/invalid. */
function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

/** Brave Search API web result shape (partial). */
interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}
