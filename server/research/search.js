/**
 * Structured web search for Deep Research — provider chain with fallback and disk cache.
 * Workspace codebase search via ripgrep (MIN-235 / MIN-175).
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { rgPath } from '@vscode/ripgrep';
import { readConfigJson } from '../config/store.js';
import { normalizeToolConfig } from '../config/validators.js';
import { getManagedSearxngUrl } from '../servers/manager.js';
import { searchBraveStructured } from '../tools/web-search-brave.js';
import { searchDdgStructured } from '../tools/web-search-ddg.js';
import { searchSearxngStructured } from '../tools/web-search-searxng.js';
import { searchTavilyStructured } from '../tools/web-search-tavily.js';
import { normalizeSearchResults } from '../tools/search-result.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';
import { getSearch, setSearch } from './cache.js';

const execFileAsync = promisify(execFile);

/** Default max structured hits from workspace search. */
export const CODEBASE_SEARCH_DEFAULT_LIMIT = 20;

/** Injectable ripgrep runner for unit tests. */
export const codebaseSearchDeps = {
  execFile: execFile,
};

/** @typedef {'searxng' | 'tavily' | 'brave' | 'duckduckgo' | 'disabled'} SearchProviderId */

/** @type {string | null} */
let lastSearchError = null;

/** @type {SearchProviderId | null} */
let lastSearchProvider = null;

const DEFAULT_FALLBACK_CHAIN = ['tavily', 'brave', 'duckduckgo'];
const DEFAULT_SEARXNG_URL = 'http://localhost:8899';
const DEFAULT_RESULT_COUNT = 10;

/**
 * Last provider error message (for engine empty-round messaging).
 * @returns {string | null}
 */
export function getLastSearchError() {
  return lastSearchError;
}

/**
 * Provider that produced the most recent non-empty result set.
 * @returns {SearchProviderId | null}
 */
export function getLastSearchProvider() {
  return lastSearchProvider;
}

/**
 * @param {unknown} value
 * @returns {SearchProviderId}
 */
function normalizeProviderId(value) {
  if (
    value === 'searxng' ||
    value === 'tavily' ||
    value === 'brave' ||
    value === 'duckduckgo' ||
    value === 'disabled'
  ) {
    return value;
  }
  return 'duckduckgo';
}

/**
 * Load search settings from search.json with tools.json fallback (Phase 0 migration).
 * @returns {Promise<{
 *   provider: SearchProviderId;
 *   fallbackChain: SearchProviderId[];
 *   searxngUrl: string;
 *   braveApiKey: string;
 *   tavilyApiKey: string;
 *   resultCount: number;
 *   researchSearchProvider: SearchProviderId | '';
 * }>}
 */
export async function loadSearchSettings() {
  const toolsRaw = (await readConfigJson('tools.json')) ?? {};
  const tools = normalizeToolConfig(toolsRaw);
  const searchRaw = await readConfigJson('search.json');
  const researchRaw = await readConfigJson('research.json');

  // When search.json is absent (pre–Phase 0), default research primary to SearXNG but keep tools keys.
  let provider =
    searchRaw && typeof searchRaw === 'object'
      ? normalizeProviderId(searchRaw.provider ?? 'searxng')
      : 'searxng';
  let fallbackChain = [...DEFAULT_FALLBACK_CHAIN];
  let searxngUrl = DEFAULT_SEARXNG_URL;
  let braveApiKey = tools.keys?.braveApiKey?.trim() ?? '';
  let tavilyApiKey = tools.keys?.tavilyApiKey?.trim() ?? '';
  let resultCount = DEFAULT_RESULT_COUNT;
  let researchSearchProvider = '';

  if (searchRaw && typeof searchRaw === 'object') {
    if (Array.isArray(searchRaw.fallbackChain)) {
      fallbackChain = searchRaw.fallbackChain
        .map((id) => normalizeProviderId(id))
        .filter((id) => id !== 'disabled' && id !== 'searxng');
    }
    if (typeof searchRaw.searxngUrl === 'string' && searchRaw.searxngUrl.trim()) {
      searxngUrl = searchRaw.searxngUrl.trim();
    }
    const keys = searchRaw.keys;
    if (keys && typeof keys === 'object') {
      if (typeof keys.braveApiKey === 'string') {
        braveApiKey = keys.braveApiKey.trim();
      }
      if (typeof keys.tavilyApiKey === 'string') {
        tavilyApiKey = keys.tavilyApiKey.trim();
      }
    }
    if (Number.isFinite(searchRaw.resultCount)) {
      resultCount = Math.min(Math.max(Number(searchRaw.resultCount), 1), 30);
    }
  }

  if (researchRaw && typeof researchRaw === 'object') {
    if (typeof researchRaw.searchProvider === 'string' && researchRaw.searchProvider.trim()) {
      researchSearchProvider = normalizeProviderId(researchRaw.searchProvider.trim());
    }
  }

  // Managed SearXNG (Settings → Servers) overrides search.json when enabled and healthy.
  const managedSearxngUrl = await getManagedSearxngUrl();
  if (managedSearxngUrl) {
    searxngUrl = managedSearxngUrl;
  }

  return {
    provider,
    fallbackChain,
    searxngUrl,
    braveApiKey,
    tavilyApiKey,
    resultCount,
    researchSearchProvider,
  };
}

/**
 * @param {SearchProviderId} primary
 * @param {SearchProviderId[]} fallbackChain
 * @returns {SearchProviderId[]}
 */
export function buildProviderChain(primary, fallbackChain) {
  const chain = [];
  const seen = new Set();

  const push = (id) => {
    if (!id || id === 'disabled' || seen.has(id)) {
      return;
    }
    seen.add(id);
    chain.push(id);
  };

  push(primary);
  for (const id of fallbackChain) {
    push(id);
  }

  if (!chain.length) {
    push('duckduckgo');
  }

  return chain;
}

/**
 * @param {SearchProviderId} providerId
 * @param {string} query
 * @param {Awaited<ReturnType<typeof loadSearchSettings>>} settings
 * @returns {Promise<{ results: import('../tools/search-result.js').SearchResult[]; error?: string }>}
 */
async function callProvider(providerId, query, settings) {
  const count = settings.resultCount;

  if (providerId === 'searxng') {
    return searchSearxngStructured(query, settings.searxngUrl, count);
  }
  if (providerId === 'tavily') {
    if (!settings.tavilyApiKey) {
      return { results: [], error: 'Error: Tavily API key not configured.' };
    }
    return searchTavilyStructured(query, settings.tavilyApiKey, count);
  }
  if (providerId === 'brave') {
    if (!settings.braveApiKey) {
      return { results: [], error: 'Error: Brave API key not configured.' };
    }
    return searchBraveStructured(query, settings.braveApiKey, count);
  }
  if (providerId === 'duckduckgo') {
    return searchDdgStructured(query);
  }

  return { results: [], error: `Error: unknown search provider "${providerId}"` };
}

/**
 * Structured search with provider chain, disk cache, and last-error tracking.
 * @param {string} query
 * @param {{ provider?: SearchProviderId; count?: number; useCache?: boolean }} [opts]
 * @returns {Promise<import('../tools/search-result.js').SearchResult[]>}
 */
export async function searchStructured(query, opts = {}) {
  lastSearchError = null;
  lastSearchProvider = null;

  const trimmed = String(query ?? '').trim();
  if (!trimmed) {
    lastSearchError = 'Error: search query is required';
    return [];
  }

  const settings = await loadSearchSettings();
  if (opts.count !== undefined && Number.isFinite(opts.count)) {
    settings.resultCount = Math.min(Math.max(Number(opts.count), 1), 30);
  }

  const primary =
    opts.provider ??
    (settings.researchSearchProvider || settings.provider || 'searxng');
  const chain = buildProviderChain(primary, settings.fallbackChain);

  const cacheKey = JSON.stringify({ query: trimmed, chain, count: settings.resultCount });
  const useCache = opts.useCache !== false;
  if (useCache) {
    const cached = await getSearch(cacheKey);
    if (cached?.length) {
      lastSearchProvider = primary;
      return cached;
    }
  }

  const errors = [];

  for (const providerId of chain) {
    const { results, error } = await callProvider(providerId, trimmed, settings);
    if (results.length > 0) {
      lastSearchProvider = providerId;
      if (useCache) {
        await setSearch(cacheKey, results);
      }
      return results;
    }
    if (error) {
      errors.push(`${providerId}: ${error}`);
    }
  }

  if (errors.length) {
    lastSearchError = errors.join(' | ');
  } else {
    lastSearchError = 'All search providers returned no results.';
  }

  return [];
}

/**
 * Parse a ripgrep content line into relative path, line number, and snippet.
 * @param {string} line
 * @param {string} workspaceRoot
 * @returns {{ relPath: string; lineNum: number; snippet: string } | null}
 */
export function parseCodebaseRipgrepLine(line, workspaceRoot) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed || trimmed === '--') {
    return null;
  }

  const match = trimmed.match(/^(.+?):(\d+):(.*)$/);
  if (!match) {
    return null;
  }

  const rawPath = match[1].replace(/\\/g, '/');
  const lineNum = Number(match[2]);
  const snippet = String(match[3] ?? '').trim();
  if (!Number.isFinite(lineNum) || lineNum < 1) {
    return null;
  }

  const absPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceRoot, rawPath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!isResolvedPathUnderRoot(absPath, normalizedRoot)) {
    return null;
  }

  const relPath = path.relative(normalizedRoot, absPath).replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('..')) {
    return null;
  }

  return { relPath, lineNum, snippet };
}

/**
 * Search the local workspace via ripgrep (honors .gitignore).
 * Returns the same shape as web search: `{ url, title, snippet }`.
 * @param {string} query
 * @param {string} [workspaceRoot]
 * @param {{ limit?: number }} [options]
 * @returns {Promise<import('../tools/search-result.js').SearchResult[]>}
 */
export async function searchCodebaseStructured(query, workspaceRoot, options = {}) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) {
    return [];
  }

  const root = workspaceRoot && String(workspaceRoot).trim()
    ? path.resolve(String(workspaceRoot).trim())
    : getWorkspaceRoot();
  const limit = Math.min(
    Math.max(Number(options.limit ?? CODEBASE_SEARCH_DEFAULT_LIMIT), 1),
    30,
  );

  const rgArgs = [
    '--max-filesize',
    '2M',
    '-n',
    '--no-heading',
    '-F',
    '-i',
    '--max-count',
    String(limit * 3),
    trimmed,
    root,
  ];

  let stdout = '';
  try {
    const result = await promisify(codebaseSearchDeps.execFile)(rgPath, rgArgs, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = result.stdout ?? '';
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    const partial = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout) : '';
    if (code === 1) {
      return [];
    }
    if (code === 2 && partial.trim()) {
      stdout = partial;
    } else {
      return [];
    }
  }

  /** @type {Map<string, import('../tools/search-result.js').SearchResult>} */
  const byFile = new Map();

  for (const line of stdout.split(/\r?\n/)) {
    const parsed = parseCodebaseRipgrepLine(line, root);
    if (!parsed) {
      continue;
    }

    const { relPath, lineNum, snippet } = parsed;
    if (byFile.has(relPath)) {
      continue;
    }

    const baseName = path.basename(relPath);
    byFile.set(relPath, {
      url: `file://${relPath}#L${lineNum}`,
      title: `${baseName}:${lineNum}`,
      snippet: snippet || `(match in ${relPath})`,
    });

    if (byFile.size >= limit) {
      break;
    }
  }

  return normalizeSearchResults([...byFile.values()]);
}
