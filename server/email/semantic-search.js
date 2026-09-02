import { createHash } from 'node:crypto';
import { getMailDb } from './store.js';
import { loadBrainConfig } from '../brain/store.js';
import { getEmbedder, embedTexts } from '../engine/embeddings.js';
import { cosineSimilarity } from '../engine/vector-store.js';

export const DEFAULT_SEMANTIC_BLEND = 0.6;

const MAX_EMBEDS_PER_QUERY = 40;

const EMBED_TIMEOUT_MS = 8_000;

/**
 * @param {{ subject?: string, summary?: string, snippet?: string }} input
 */
export function threadEmbedText(input) {
  const subject = String(input.subject ?? '').trim();
  const gist = String(input.summary ?? '').trim() || String(input.snippet ?? '').trim();
  return [subject, gist].filter(Boolean).join('\n').slice(0, 1000);
}

/**
 * @param {number} similarity
 * @param {number} rankIndex
 * @param {number} total
 * @param {number} [blend]
 */
export function blendScore(similarity, rankIndex, total, blend = DEFAULT_SEMANTIC_BLEND) {
  const ftsScore = total > 1 ? 1 - rankIndex / (total - 1) : 1;
  const semantic = (Math.max(-1, Math.min(1, similarity)) + 1) / 2;
  return blend * semantic + (1 - blend) * ftsScore;
}

export async function isSemanticRerankEnabled() {
  try {
    const brain = await loadBrainConfig();
    return brain?.embeddings?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * @param {string} accountId
 * @param {string} query
 * @param {Array<Record<string, unknown>>} messages
 */
export async function semanticRerankMessages(accountId, query, messages) {
  if (!Array.isArray(messages) || messages.length < 2 || !String(query ?? '').trim()) {
    return messages;
  }

  try {
    const brain = await loadBrainConfig();
    if (brain?.embeddings?.enabled !== true) {
      return messages;
    }
    const embedder = await getEmbedder(brain);
    const db = getMailDb(accountId);

    /** @type {Map<string, string>} threadId → embed text */
    const textByThread = new Map();
    for (const message of messages) {
      const threadId = String(message.threadId ?? '');
      if (!threadId || textByThread.has(threadId)) continue;
      const thread = db
        .prepare('SELECT subject, snippet, summary FROM threads WHERE thread_id = ?')
        .get(threadId);
      let summaryText = '';
      if (typeof thread?.summary === 'string' && thread.summary) {
        try {
          summaryText = JSON.parse(thread.summary)?.text ?? '';
        } catch {
          summaryText = '';
        }
      }
      const text = threadEmbedText({
        subject: thread?.subject ?? message.subject,
        summary: summaryText || (message.triage && message.triage.summary) || '',
        snippet: thread?.snippet ?? message.bodyPreview,
      });
      if (text) textByThread.set(threadId, text);
    }

    const readVector = db.prepare(
      'SELECT input_hash, model, vector_json FROM thread_vectors WHERE thread_id = ?',
    );
    const writeVector = db.prepare(
      `INSERT INTO thread_vectors (thread_id, input_hash, model, dim, vector_json, updated_at)
       VALUES (@thread_id, @input_hash, @model, @dim, @vector_json, @updated_at)
       ON CONFLICT(thread_id) DO UPDATE SET
         input_hash = excluded.input_hash, model = excluded.model, dim = excluded.dim,
         vector_json = excluded.vector_json, updated_at = excluded.updated_at`,
    );

    /** @type {Map<string, number[]>} */
    const vectorByThread = new Map();
    /** @type {Array<{ threadId: string, text: string, hash: string }>} */
    const toEmbed = [];

    for (const [threadId, text] of textByThread) {
      const hash = createHash('sha1').update(`${embedder.id}\n${text}`).digest('hex');
      const stored = readVector.get(threadId);
      if (stored && stored.input_hash === hash && stored.model === embedder.id) {
        try {
          const vector = JSON.parse(stored.vector_json);
          if (Array.isArray(vector) && vector.length) {
            vectorByThread.set(threadId, vector);
            continue;
          }
        } catch {
        }
      }
      if (toEmbed.length < MAX_EMBEDS_PER_QUERY) {
        toEmbed.push({ threadId, text, hash });
      }
    }

    const inputs = [String(query).trim(), ...toEmbed.map((row) => row.text)];
    const vectors = await embedTexts(embedder, inputs, EMBED_TIMEOUT_MS);
    const queryVector = vectors[0];
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return messages;
    }

    const now = new Date().toISOString();
    toEmbed.forEach((row, index) => {
      const vector = vectors[index + 1];
      if (!Array.isArray(vector) || vector.length === 0) return;
      vectorByThread.set(row.threadId, vector);
      writeVector.run({
        thread_id: row.threadId,
        input_hash: row.hash,
        model: embedder.id,
        dim: vector.length,
        vector_json: JSON.stringify(vector),
        updated_at: now,
      });
    });

    const blend = Number(brain.embeddings.blendWeight);
    const blendWeight = Number.isFinite(blend) ? Math.max(0, Math.min(1, blend)) : DEFAULT_SEMANTIC_BLEND;

    const scored = messages.map((message, index) => {
      const vector = vectorByThread.get(String(message.threadId ?? ''));
      const similarity = vector ? cosineSimilarity(queryVector, vector) : 0;
      return {
        message,
        score: blendScore(similarity, index, messages.length, blendWeight),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((row) => row.message);
  } catch (err) {
    console.warn(
      '[email/semantic-search] rerank failed, keeping FTS order:',
      err instanceof Error ? err.message : err,
    );
    return messages;
  }
}
