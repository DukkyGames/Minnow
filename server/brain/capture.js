/**
 * Manual chat/research capture into stable Brain wiki summary pages (user-triggered).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { llmCall } from '../research/llm.js';
import { getResearchDetail } from '../research/store.js';
import { getBrainSourcesDir } from './paths.js';
import { appendLog, createPage, readPage, updatePage } from './store.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { parseExtractionJson } from './synthesis.js';
import { buildExtractiveArchiveBundle } from './archive.js';

const CAPTURE_CHAT_PROMPT = `You summarize a completed chat into a concise personal wiki page.

Return a JSON object with:
- "title": short page title
- "summary": one-line summary for catalog frontmatter
- "body": markdown with sections: ## TL;DR, ## Key points, ## Decisions, ## Open questions

Be conservative — only include facts present in the transcript. Do not invent details. Return ONLY valid JSON, no markdown fences.`;

/** Extract plain text from a bundled API message shape. */
function messageText(turn) {
  const role = turn?.role;
  const content = turn?.content;
  if (role === 'tool') return String(content ?? '');
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === 'object' && p.type === 'text')
      .map((p) => String(p.text ?? ''))
      .join('\n');
  }
  return '';
}

/**
 * Stable wiki path for a chat summary page.
 * @param {string} workspaceKey
 * @param {string} chatId
 */
export function chatCaptureRelPath(workspaceKey, chatId) {
  const key = String(workspaceKey ?? '').trim() || 'workspace';
  const id = String(chatId ?? '').trim();
  return `workspaces/${key}/summaries/chat-${id}.md`;
}

/**
 * Stable wiki path for a research summary page.
 * @param {string} researchId
 */
export function researchCaptureRelPath(researchId) {
  const id = String(researchId ?? '').trim();
  return `research/${id}.md`;
}

/**
 * Parse LLM JSON object for chat capture.
 * @param {string} raw
 */
function parseCaptureChatJson(raw) {
  const rows = parseExtractionJson(raw);
  if (rows.length === 1 && rows[0] && typeof rows[0] === 'object') {
    return /** @type {Record<string, unknown>} */ (rows[0]);
  }
  let s = String(raw ?? '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Deterministic chat page when LLM is unavailable or fails.
 * @param {object[]} messages
 * @param {string} fallbackTitle
 */
export function buildExtractiveChatCapture(messages, fallbackTitle) {
  const turns = messages.map((m, i) => ({
    role: m.role,
    content: m.content,
    _idx: i,
  }));
  const indices = turns.map((_, i) => i);
  const bundle = buildExtractiveArchiveBundle(turns, indices);
  const bullets = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = messageText(msg).trim();
    if (!text) continue;
    const label = msg.role === 'user' ? 'User' : 'Assistant';
    const excerpt = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    bullets.push(`- **${label}:** ${excerpt}`);
  }
  const title = String(fallbackTitle ?? '').trim() || bundle.title || 'Chat summary';
  const body = [
    '## TL;DR',
    '',
    `_Extractive summary — utility model unavailable._`,
    '',
    '## Conversation',
    '',
    bullets.length ? bullets.join('\n') : '_No user/assistant messages._',
  ].join('\n');
  const summary = bullets[0]
    ? bullets[0].replace(/^- \*\*[^:]+:\*\* /, '').slice(0, 160)
    : title;
  return { title, summary, body };
}

/**
 * @param {string} relPath
 * @param {object} fields
 */
export async function upsertPageAtPath(relPath, fields) {
  let existing = null;
  try {
    existing = await readPage(relPath);
  } catch {
    existing = null;
  }

  if (existing) {
    const updated = await updatePage(relPath, {
      title: fields.title,
      body: fields.body,
      tags: fields.tags,
      summary: fields.summary,
      source: fields.source,
      input_hash: fields.input_hash,
    });
    return {
      ok: true,
      relPath,
      title: updated.meta.title,
      pageId: updated.meta.id,
      created: false,
    };
  }

  const created = await createPage({
    relPath,
    title: fields.title,
    body: fields.body,
    tags: fields.tags,
    summary: fields.summary,
    source: fields.source,
    chatId: fields.chatId,
    input_hash: fields.input_hash,
  });
  return {
    ok: true,
    relPath,
    title: created.meta.title,
    pageId: created.meta.id,
    created: true,
  };
}

/**
 * @param {object[]} messages
 * @param {string} fallbackTitle
 * @param {boolean} extractiveOnly
 */
async function summarizeChat(messages, fallbackTitle, extractiveOnly) {
  if (extractiveOnly) {
    return buildExtractiveChatCapture(messages, fallbackTitle);
  }

  const cfg = await loadSynthesisConfig();
  const modelBinding = await resolveSynthesisModel(cfg);
  const transcript = messages
    .map((m) => `--- ${m.role} ---\n${messageText(m)}`)
    .join('\n\n');

  if (modelBinding?.providerId && modelBinding?.model) {
    try {
      const llmRaw = await llmCall({
        providerId: modelBinding.providerId,
        model: modelBinding.model,
        messages: [
          { role: 'system', content: CAPTURE_CHAT_PROMPT },
          { role: 'user', content: transcript.slice(0, 48_000) },
        ],
        temperature: 0.2,
        maxTokens: 4096,
        timeoutMs: 60_000,
      });
      const parsed = parseCaptureChatJson(llmRaw);
      const title = String(parsed?.title ?? '').trim();
      const body = String(parsed?.body ?? '').trim();
      const summary = String(parsed?.summary ?? '').trim();
      if (title && body) {
        return {
          title,
          summary: summary || title,
          body,
        };
      }
    } catch {
      /* fall through to extractive */
    }
  }

  return buildExtractiveChatCapture(messages, fallbackTitle);
}

/**
 * Capture a chat transcript into a stable workspace summary page.
 * @param {{ chatId: string; title?: string; workspaceKey?: string; messages: object[]; extractiveOnly?: boolean }} input
 */
export async function captureChatToBrain(input) {
  const chatId = String(input?.chatId ?? '').trim();
  if (!chatId) {
    const err = new Error('chatId is required');
    err.statusCode = 400;
    throw err;
  }

  const messages = Array.isArray(input?.messages) ? input.messages : [];
  const hasDialogue = messages.some((m) => {
    const role = m?.role;
    if (role !== 'user' && role !== 'assistant') return false;
    return messageText(m).trim().length > 0;
  });
  if (!hasDialogue) {
    const err = new Error('At least one user or assistant message is required');
    err.statusCode = 400;
    throw err;
  }

  const workspaceKey = String(input?.workspaceKey ?? '').trim() || 'workspace';
  const relPath = chatCaptureRelPath(workspaceKey, chatId);
  const fallbackTitle = String(input?.title ?? '').trim() || `Chat ${chatId.slice(0, 8)}`;
  const extractiveOnly = input?.extractiveOnly === true;

  const summary = await summarizeChat(messages, fallbackTitle, extractiveOnly);
  const tags = ['capture', 'chat', `chat:${chatId}`];

  const result = await upsertPageAtPath(relPath, {
    title: summary.title,
    body: summary.body,
    tags,
    summary: summary.summary,
    source: 'user',
    chatId,
  });

  await appendLog(`captured chat ${chatId} → ${relPath}`);
  return result;
}

/**
 * Build deterministic markdown body for a research report page.
 * @param {{ query?: string; result?: string; sources?: object[] }} detail
 */
export function buildResearchCaptureBody(detail) {
  const query = String(detail?.query ?? 'Research report').trim();
  const markdown = String(detail?.result ?? '').trim();
  const sources = Array.isArray(detail?.sources) ? detail.sources : [];

  const parts = [`# ${query}`, ''];
  if (markdown) {
    parts.push(markdown);
  } else {
    parts.push('_No report body available._');
  }

  if (sources.length) {
    parts.push('', '## Sources', '');
    sources.forEach((src, i) => {
      const row = src && typeof src === 'object' ? src : {};
      const title = String(row.title ?? row.url ?? `Source ${i + 1}`);
      const url = String(row.url ?? '').trim();
      parts.push(url ? `- [${title}](${url})` : `- ${title}`);
    });
  }

  return parts.join('\n');
}

/** One-line summary from research markdown. */
function researchSummaryFromMarkdown(markdown, query) {
  const lines = String(markdown ?? '').split('\n');
  const tldrIdx = lines.findIndex((l) => /^##\s+tl;?dr/i.test(l.trim()));
  if (tldrIdx >= 0) {
    for (let i = tldrIdx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('##')) break;
      return line.replace(/^\*+|\*+$/g, '').slice(0, 200);
    }
  }
  return query.slice(0, 200);
}

/**
 * Capture a completed research report into a stable wiki page.
 * @param {{ researchId: string }} input
 */
export async function captureResearchToBrain(input) {
  const researchId = String(input?.researchId ?? '').trim();
  if (!researchId) {
    const err = new Error('researchId is required');
    err.statusCode = 400;
    throw err;
  }

  const detail = await getResearchDetail(researchId);
  if (!detail) {
    const err = new Error(`Research not found: ${researchId}`);
    err.statusCode = 404;
    throw err;
  }

  const query = String(detail.query ?? 'Research report').trim();
  const reportMarkdown = String(detail.result ?? detail.raw_report ?? '').trim();
  if (!reportMarkdown) {
    const err = new Error('Research report has no result body');
    err.statusCode = 400;
    throw err;
  }

  const sourcesDir = getBrainSourcesDir();
  await fs.mkdir(sourcesDir, { recursive: true });
  const hash = createHash('sha256').update(reportMarkdown).digest('hex').slice(0, 16);
  const storedName = `${hash}-research-${researchId}.md`;
  const storedPath = path.join(sourcesDir, storedName);
  await fs.writeFile(storedPath, reportMarkdown, 'utf8');

  const relPath = researchCaptureRelPath(researchId);
  const body = buildResearchCaptureBody({
    query,
    result: reportMarkdown,
    sources: Array.isArray(detail.sources) ? detail.sources : [],
  });
  const summary = researchSummaryFromMarkdown(reportMarkdown, query);
  const tags = ['capture', 'research', `research:${researchId}`];

  const result = await upsertPageAtPath(relPath, {
    title: query,
    body,
    tags,
    summary,
    source: 'user',
    input_hash: hash,
  });

  await appendLog(`captured research ${researchId} → ${relPath}`);
  return result;
}
