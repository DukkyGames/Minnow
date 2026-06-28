/**
 * Ingest non-code sources into immutable sources/ + synthesized wiki pages.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { llmCall } from '../research/llm.js';
import { getBrainSourcesDir } from './paths.js';
import { appendLog, createPage, loadBrainConfig } from './store.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { slugifyFactTitle, parseExtractionJson } from './synthesis.js';

const INGEST_SYSTEM_PROMPT = `You convert a raw source document into one or more wiki pages for a personal knowledge base.

Return a JSON array of page objects with:
- "relPath": relative path under pages/ ending in .md (e.g. "edgeflight/overview.md" or "facts/api-preference.md")
- "title": short page title
- "body": markdown body (may include [[wikilinks]] to other pages)
- "tags": string array
- "summary": one-line summary

Rules:
- Prefer updating existing topics with clear relPaths when the source extends them
- Use facts/ only for discrete personal facts
- Keep bodies concise and structured
- Return ONLY valid JSON, no markdown fences`;

/**
 * @param {string} raw
 * @returns {Array<{ relPath: string, title: string, body: string, tags?: string[], summary?: string }>}
 */
export function parseIngestPagesJson(raw) {
  const rows = parseExtractionJson(raw);
  const pages = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const relPath = String(r.relPath ?? '').replace(/\\/g, '/').trim();
    const title = String(r.title ?? '').trim();
    const body = String(r.body ?? '').trim();
    if (!relPath || !title || !body) continue;
    if (!relPath.endsWith('.md')) continue;
    pages.push({
      relPath,
      title,
      body,
      tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t)) : [],
      summary: String(r.summary ?? ''),
    });
  }
  return pages;
}

/**
 * Store raw source and synthesize wiki pages from it.
 * @param {{ content: string, filename?: string, title?: string }} input
 */
export async function ingestSource(input) {
  const raw = String(input.content ?? '');
  if (!raw.trim()) {
    const err = new Error('content is required');
    err.statusCode = 400;
    throw err;
  }

  const sourcesDir = getBrainSourcesDir();
  await fs.mkdir(sourcesDir, { recursive: true });
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const baseName = path.basename(String(input.filename ?? 'source.txt'));
  const storedName = `${hash}-${baseName}`;
  const storedPath = path.join(sourcesDir, storedName);
  await fs.writeFile(storedPath, raw, 'utf8');

  const cfg = await loadSynthesisConfig();
  const modelBinding = await resolveSynthesisModel(cfg);
  if (!modelBinding?.providerId || !modelBinding?.model) {
    const err = new Error('No utility model available for ingest');
    err.statusCode = 503;
    throw err;
  }

  const label = String(input.title ?? baseName);
  const llmRaw = await llmCall({
    providerId: modelBinding.providerId,
    model: modelBinding.model,
    messages: [
      { role: 'system', content: INGEST_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Source title: ${label}\n\n---\n\n${raw.slice(0, 48_000)}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 60_000,
  });

  const planned = parseIngestPagesJson(llmRaw);
  const touched = [];
  const brainConfig = await loadBrainConfig();

  for (const plan of planned) {
    try {
      const created = await createPage({
        relPath: plan.relPath,
        title: plan.title,
        body: plan.body,
        tags: plan.tags,
        summary: plan.summary,
        source: 'ingest',
        input_hash: hash,
      });
      touched.push(created.path);
    } catch (err) {
      const status = err && typeof err === 'object' && 'statusCode' in err ? err.statusCode : null;
      if (status === 409) {
        const slug = slugifyFactTitle(plan.title);
        const fallback = `facts/${slug}-${randomUUID().slice(0, 8)}.md`;
        const created = await createPage({
          relPath: fallback,
          title: plan.title,
          body: plan.body,
          tags: plan.tags,
          summary: plan.summary,
          source: 'ingest',
          input_hash: hash,
        });
        touched.push(created.path);
      } else {
        throw err;
      }
    }
  }

  await appendLog(`ingested ${storedName} → ${touched.length} page(s)`);
  void brainConfig;

  return {
    sourcePath: storedName,
    pages: touched,
  };
}

/**
 * Delete all raw files under ~/.minnow/brain/sources/ (not synthesized wiki pages).
 * @param {{ archive?: boolean }} [opts]
 * @returns {Promise<{ removed: number, archivePath?: string }>}
 */
export async function clearIngestSources(opts = {}) {
  const { backupBrain } = await import('./backup.js');
  let archivePath;
  if (opts.archive === true) {
    const backup = await backupBrain();
    archivePath = backup.path;
  }

  const sourcesDir = getBrainSourcesDir();
  let removed = 0;
  try {
    const names = await fs.readdir(sourcesDir);
    for (const name of names) {
      const fp = path.join(sourcesDir, name);
      const stat = await fs.stat(fp);
      if (!stat.isFile()) continue;
      await fs.unlink(fp);
      removed += 1;
    }
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }

  await appendLog(`cleared ${removed} ingest source file(s)`);
  return { removed, archivePath };
}
