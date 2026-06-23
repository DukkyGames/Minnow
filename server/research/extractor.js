/**
 * Per-page goal-based extraction for Deep Research (Odysseus `_fetch_and_extract`).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_FETCH_USER_AGENT,
  stripHtmlToPlainText,
  validateHttpUrl,
} from '../../src/lib/fetch-web-content.mjs';
import { getWorkspaceRoot } from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';
import { getPage, setPage } from './cache.js';
import { prepareResearchFetchUrl } from './fetch-prep.js';
import { llmCall as defaultLlmCall } from './llm.js';
import { parseJsonObject } from './json-parse.js';
import { EXTRACTOR_PROMPT, formatPrompt } from './prompts.js';
import { isLowQuality } from './strip-thinking.js';
import { wrapUntrusted } from '../security/untrusted.js';

/** Injectable deps for unit tests. */
export const extractorDeps = {
  fetchFn: fetch,
  llmCall: defaultLlmCall,
  getPage,
  setPage,
  prepareResearchFetchUrl,
};

/**
 * Truncate plain text at a paragraph boundary (Odysseus `max_content_chars` logic).
 * @param {string} content
 * @param {number} maxChars
 * @returns {string}
 */
export function truncateAtParagraph(content, maxChars) {
  if (content.length <= maxChars) {
    return content;
  }
  const truncated = content.slice(0, maxChars);
  const lastPara = truncated.lastIndexOf('\n\n');
  if (lastPara > maxChars * 0.8) {
    return truncated.slice(0, lastPara);
  }
  return truncated;
}

/**
 * True when a research URL refers to a workspace file rather than HTTP.
 * @param {string} urlString
 */
export function isLocalResearchUrl(urlString) {
  const trimmed = String(urlString ?? '').trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('file://')) {
    return true;
  }
  return !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('//');
}

/**
 * Resolve a local research URL to an absolute path under the workspace.
 * @param {string} urlString
 * @param {string} [workspaceRoot]
 * @returns {{ absPath: string; relPath: string } | null}
 */
export function resolveLocalResearchPath(urlString, workspaceRoot) {
  let raw = String(urlString ?? '').trim();
  if (raw.startsWith('file://')) {
    raw = raw.slice('file://'.length);
  }
  const hashIdx = raw.indexOf('#');
  if (hashIdx >= 0) {
    raw = raw.slice(0, hashIdx);
  }
  raw = raw.replace(/\\/g, '/').trim();
  if (!raw) {
    return null;
  }

  const root = workspaceRoot && String(workspaceRoot).trim()
    ? path.resolve(String(workspaceRoot).trim())
    : getWorkspaceRoot();
  const absPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (!isResolvedPathUnderRoot(absPath, root)) {
    return null;
  }

  const relPath = path.relative(root, absPath).replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('..')) {
    return null;
  }

  return { absPath, relPath };
}

/**
 * Read workspace file text for codebase research extraction.
 * @param {string} urlString
 * @param {number} maxContentChars
 * @param {string} [workspaceRoot]
 * @returns {Promise<{ success: boolean; content: string; title: string }>}
 */
export async function fetchLocalFileText(urlString, maxContentChars, workspaceRoot) {
  const resolved = resolveLocalResearchPath(urlString, workspaceRoot);
  if (!resolved) {
    return { success: false, content: '', title: '' };
  }

  let content = '';
  try {
    content = await fs.readFile(resolved.absPath, 'utf8');
  } catch {
    return { success: false, content: '', title: '' };
  }

  return {
    success: true,
    content: truncateAtParagraph(content, maxContentChars),
    title: path.basename(resolved.relPath),
  };
}

/**
 * Fetch page HTML and return stripped plain text (research cap, not 8 KB tool cap).
 * @param {string} urlString
 * @param {number} maxContentChars
 * @returns {Promise<{ success: boolean; content: string; title: string }>}
 */
export async function fetchResearchPageText(urlString, maxContentChars) {
  try {
    await extractorDeps.prepareResearchFetchUrl(urlString);
  } catch {
    return { success: false, content: '', title: '' };
  }

  const validated = validateHttpUrl(urlString);
  if (!validated.ok) {
    return { success: false, content: '', title: '' };
  }

  const cached = await extractorDeps.getPage(urlString);
  if (cached) {
    return {
      success: true,
      content: truncateAtParagraph(cached, maxContentChars),
      title: '',
    };
  }

  let response;
  try {
    response = await extractorDeps.fetchFn(validated.url.toString(), {
      headers: {
        'User-Agent': DEFAULT_FETCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch {
    return { success: false, content: '', title: '' };
  }

  if (!response.ok) {
    return { success: false, content: '', title: '' };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  let plain =
    contentType.includes('text/html') || body.trimStart().startsWith('<')
      ? stripHtmlToPlainText(body)
      : body;

  plain = truncateAtParagraph(plain, maxContentChars);
  await extractorDeps.setPage(urlString, plain);

  let title = '';
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = stripHtmlToPlainText(titleMatch[1]).trim();
  }

  return { success: true, content: plain, title };
}

/**
 * @typedef {object} ResearchFinding
 * @property {string} [rational]
 * @property {string} [evidence]
 * @property {string} [summary]
 * @property {string} url
 * @property {string} [title]
 */

/**
 * Fetch a URL and extract goal-relevant JSON via the extractor prompt.
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.question
 * @param {string} [params.title]
 * @param {string} params.providerId
 * @param {string} params.model
 * @param {number} params.maxContentChars
 * @param {number} params.extractionTimeoutSeconds
 * @param {string} [params.workspaceRoot]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<ResearchFinding | null>}
 */
export async function fetchAndExtract({
  url,
  question,
  title = '',
  providerId,
  model,
  maxContentChars,
  extractionTimeoutSeconds,
  workspaceRoot,
  signal,
}) {
  const page = isLocalResearchUrl(url)
    ? await fetchLocalFileText(url, maxContentChars, workspaceRoot)
    : await fetchResearchPageText(url, maxContentChars);
  if (!page.success || !page.content) {
    return null;
  }

  const prompt = formatPrompt(EXTRACTOR_PROMPT, {
    webpage_content: wrapUntrusted(page.content, {
      source: isLocalResearchUrl(url) ? `research-file:${url}` : `research-page:${url}`,
    }),
    goal: question,
  });

  try {
    const response = await extractorDeps.llmCall({
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
        url,
        title: title || page.title || '',
      };
      if (isLowQuality(finding.summary)) {
        return null;
      }
      return finding;
    }

    return {
      url,
      title: title || page.title || '',
      rational: 'LLM extraction (raw)',
      evidence: response.slice(0, 3000),
      summary: response.slice(0, 500),
    };
  } catch {
    return null;
  }
}
