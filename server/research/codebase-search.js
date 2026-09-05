/**
 * Local codebase search + extraction for Deep Research (MIN-175).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRipgrepPath } from '../lib/ripgrep-path.js';
import { resolveSafePath } from '../runtime/path-access.js';
import { wrapUntrusted } from '../security/untrusted.js';
import { truncateAtParagraph } from './extractor.js';
import { parseJsonObject } from './json-parse.js';
import { llmCall as defaultLlmCall } from './llm.js';
import { EXTRACTOR_PROMPT, formatPrompt } from './prompts.js';
import { isLowQuality } from './strip-thinking.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

const execFileAsync = promisify(execFile);

const rgExecutable = getRipgrepPath();

/** Ripgrep skip globs (match brain indexer / grep tool). */
const RG_SKIP_GLOBS = ['!**/node_modules/**', '!**/.git/**', '!**/dist/**', '!**/build/**'];

/** Default max distinct files returned per query. */
export const DEFAULT_CODEBASE_MAX_FILES = 10;

/** Injectable deps for unit tests. */
export const codebaseSearchDeps = {
  llmCall: defaultLlmCall,
  readFile: (filePath) => fs.readFile(filePath, 'utf8'),
  rgSearch: null,
  rgListFiles: null,
};

/**
 * @typedef {{ path: string; title: string; snippet: string }} CodebaseSearchResult
 * @typedef {import('./extractor.js').ResearchFinding} ResearchFinding
 */

/**
 * @param {string} absPath
 * @param {string} root
 * @returns {string}
 */
function toRelativePath(absPath, root) {
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  return rel === '' ? '.' : rel;
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function titleFromPath(relPath) {
  const base = path.basename(relPath);
  return base || relPath;
}

/**
 * Pull likely search tokens from a natural-language query.
 * @param {string} query
 * @returns {string[]}
 */
export function extractSearchTerms(query) {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'how',
    'what',
    'where',
    'when',
    'why',
    'does',
    'do',
    'did',
    'in',
    'of',
    'to',
    'for',
    'and',
    'or',
    'with',
    'this',
    'that',
    'it',
    'from',
    'about',
    'into',
    'local',
    'codebase',
    'code',
    'file',
    'files',
  ]);

  /** @type {Set<string>} */
  const terms = new Set();
  const idents = query.match(/[A-Za-z_][A-Za-z0-9_.-]{2,}/g) ?? [];
  for (const ident of idents) {
    if (!stopWords.has(ident.toLowerCase())) {
      terms.add(ident);
    }
  }

  for (const token of query.replace(/[^\w\s./-]/g, ' ').split(/\s+/)) {
    const trimmed = token.trim();
    if (trimmed.length >= 2 && !stopWords.has(trimmed.toLowerCase())) {
      terms.add(trimmed);
    }
  }

  return [...terms].slice(0, 8);
}

/**
 * @param {string} root
 * @param {string} pattern
 * @returns {Promise<string>}
 */
async function defaultRgSearch(root, pattern) {
  const args = [
    '--no-messages',
    '-n',
    '--no-heading',
    '--max-filesize',
    '2M',
    ...RG_SKIP_GLOBS.flatMap((glob) => ['--glob', glob]),
    '--max-count',
    '3',
    '-i',
    pattern,
    root,
  ];
  try {
    const { stdout } = await execFileAsync(rgExecutable, args, {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout ?? '';
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined;
    if (code === 1) {
      return '';
    }
    const partial = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout) : '';
    if (code === 2 && partial.trim()) {
      return partial;
    }
    throw err;
  }
}

/**
 * @param {string} root
 * @param {string} globFragment
 * @returns {Promise<string[]>}
 */
async function defaultRgListFiles(root, globFragment) {
  const args = [
    '--files',
    '--no-messages',
    ...RG_SKIP_GLOBS.flatMap((glob) => ['--glob', glob]),
    '--glob',
    `*${globFragment}*`,
    root,
  ];
  try {
    const { stdout } = await execFileAsync(rgExecutable, args, {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined;
    if (code === 1) {
      return [];
    }
    throw err;
  }
}

/**
 * Parse a ripgrep content line into { filePath, snippet }.
 * @param {string} line
 * @param {string} root
 */
function parseRipgrepLine(line, root) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const colonMatch = trimmed.match(/^(.+?):(\d+)[:-](.*)$/);
  if (colonMatch) {
    const [, filePath, , content] = colonMatch;
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
    return {
      relPath: toRelativePath(abs, root),
      snippet: String(content).trim().slice(0, 240),
    };
  }

  return null;
}

/**
 * Structured local search mirroring searchStructured() shape but from workspace files.
 * @param {string} query
 * @param {{ root?: string; maxFiles?: number }} [opts]
 * @returns {Promise<CodebaseSearchResult[]>}
 */
export async function searchCodebase(query, opts = {}) {
  const root = path.resolve(opts.root ?? getEffectiveWorkspaceRoot());
  const maxFiles = Math.max(1, Math.min(30, Number(opts.maxFiles ?? DEFAULT_CODEBASE_MAX_FILES)));
  const terms = extractSearchTerms(query);
  const searchTerms = terms.length ? terms : [query.trim()].filter(Boolean);
  if (!searchTerms.length) {
    return [];
  }

  const rgSearch = codebaseSearchDeps.rgSearch ?? defaultRgSearch;
  const rgListFiles = codebaseSearchDeps.rgListFiles ?? defaultRgListFiles;

  /** @type {Map<string, { snippet: string; score: number }>} */
  const fileHits = new Map();

  for (const term of searchTerms) {
    const stdout = await rgSearch(root, term);
    for (const line of stdout.split(/\r?\n/)) {
      const parsed = parseRipgrepLine(line, root);
      if (!parsed) {
        continue;
      }
      const existing = fileHits.get(parsed.relPath);
      if (existing) {
        existing.score += 1;
        if (parsed.snippet && !existing.snippet.includes(parsed.snippet)) {
          existing.snippet = `${existing.snippet}; ${parsed.snippet}`.slice(0, 320);
        }
      } else {
        fileHits.set(parsed.relPath, { snippet: parsed.snippet, score: 1 });
      }
    }

    if (fileHits.size < maxFiles && term.length >= 3) {
      const fileMatches = await rgListFiles(root, term);
      for (const absPath of fileMatches) {
        const relPath = toRelativePath(absPath.startsWith(root) ? absPath : path.resolve(root, absPath), root);
        const existing = fileHits.get(relPath);
        if (existing) {
          existing.score += 1;
        } else {
          fileHits.set(relPath, { snippet: `Filename match for "${term}"`, score: 1 });
        }
      }
    }
  }

  return [...fileHits.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxFiles)
    .map(([relPath, hit]) => ({
      path: relPath,
      title: titleFromPath(relPath),
      snippet: hit.snippet || '(match)',
    }));
}

/**
 * Read a workspace file and extract goal-relevant JSON via the shared extractor prompt.
 * @param {object} params
 * @param {string} params.path
 * @param {string} params.question
 * @param {string} [params.title]
 * @param {string} params.providerId
 * @param {string} params.model
 * @param {number} params.maxContentChars
 * @param {number} params.extractionTimeoutSeconds
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<ResearchFinding | null>}
 */
export async function extractFromFile({
  path: filePath,
  question,
  title = '',
  providerId,
  model,
  maxContentChars,
  extractionTimeoutSeconds,
  signal,
}) {
  let absPath;
  try {
    absPath = resolveSafePath(filePath);
  } catch {
    return null;
  }

  let content;
  try {
    content = await codebaseSearchDeps.readFile(absPath);
  } catch {
    return null;
  }

  if (!content.trim()) {
    return null;
  }

  const relPath = filePath.replace(/\\/g, '/');
  content = truncateAtParagraph(content, maxContentChars);

  const prompt = formatPrompt(EXTRACTOR_PROMPT, {
    webpage_content: wrapUntrusted(content, { source: `research-file:${relPath}` }),
    goal: question,
  });

  try {
    const response = await codebaseSearchDeps.llmCall({
      providerId,
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: Math.min(3_600_000, Math.max(15_000, extractionTimeoutSeconds * 1000)),
      signal,
    });

    const parsed = parseJsonObject(response);
    if (parsed) {
      const finding = {
        rational: String(parsed.rational ?? ''),
        evidence: String(parsed.evidence ?? ''),
        summary: String(parsed.summary ?? ''),
        url: relPath,
        title: title || titleFromPath(relPath),
      };
      if (isLowQuality(finding.summary)) {
        return null;
      }
      return finding;
    }

    return {
      url: relPath,
      title: title || titleFromPath(relPath),
      rational: 'LLM extraction (raw)',
      evidence: response.slice(0, 3000),
      summary: response.slice(0, 500),
    };
  } catch {
    return null;
  }
}
