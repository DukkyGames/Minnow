/**
 * Per-page goal-based extraction for Deep Research (Odysseus `_fetch_and_extract`).
 */

import {
  DEFAULT_FETCH_USER_AGENT,
  stripHtmlToPlainText,
  validateHttpUrl,
} from '../../src/lib/fetch-web-content.mjs';
import { getPage, setPage } from './cache.js';
import { prepareResearchFetchUrl } from './fetch-prep.js';
import { llmCall as defaultLlmCall } from './llm.js';
import { parseJsonObject } from './json-parse.js';
import { EXTRACTOR_PROMPT, formatPrompt } from './prompts.js';
import { isLowQuality } from './strip-thinking.js';

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
  signal,
}) {
  const page = await fetchResearchPageText(url, maxContentChars);
  if (!page.success || !page.content) {
    return null;
  }

  const prompt = formatPrompt(EXTRACTOR_PROMPT, {
    webpage_content: page.content,
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
