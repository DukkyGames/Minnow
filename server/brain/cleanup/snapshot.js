/**
 * Compact wiki snapshot for cleanup planning — catalog, diagnostics, selective bodies.
 */

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getBrainIndexPath, getBrainSchemaPath } from '../paths.js';
import { loadCatalog } from '../store.js';
import { loadAllPagesWithBodies } from '../retrieve.js';

const DEFAULT_MAX_CHARS = 100_000;
const MIN_MAX_CHARS = 80_000;
const MAX_MAX_CHARS = 120_000;
const EXCERPT_CHARS = 500;
const SCHEMA_EXCERPT_CHARS = 4000;

/**
 * Normalize max snapshot size into the supported budget range.
 * @param {number | undefined} value
 */
function normalizeMaxChars(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS;
  return Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, Math.round(n)));
}

/**
 * Collect wiki page paths referenced by a diagnostics report.
 * @param {Record<string, unknown>} diagnostics
 * @returns {Set<string>}
 */
export function pathsFromDiagnostics(diagnostics) {
  const paths = new Set();
  const addPath = (p) => {
    const rel = String(p ?? '').replace(/\\/g, '/').trim();
    if (!rel) return;
    paths.add(rel.endsWith('.md') ? rel : `${rel}.md`);
  };

  for (const row of /** @type {Array<{ path?: string }>} */ (diagnostics.orphans ?? [])) {
    addPath(row.path);
  }
  for (const row of /** @type {Array<{ path?: string }>} */ (diagnostics.stale ?? [])) {
    addPath(row.path);
  }
  for (const row of /** @type {Array<{ path?: string }>} */ (diagnostics.anchorDrift ?? [])) {
    addPath(row.path);
  }
  for (const row of /** @type {Array<{ from?: string }>} */ (diagnostics.missingLinks ?? [])) {
    addPath(row.from);
  }
  const weakLinks = diagnostics.weakSimilarLinks;
  const weakRemovals =
    weakLinks &&
    typeof weakLinks === 'object' &&
    !Array.isArray(weakLinks) &&
    Array.isArray(weakLinks.removals)
      ? weakLinks.removals
      : [];
  for (const row of weakRemovals) {
    addPath(row.path);
  }
  for (const row of /** @type {Array<{ pages?: string[] }>} */ (diagnostics.contradictions ?? [])) {
    for (const p of row.pages ?? []) addPath(p);
  }
  return paths;
}

/**
 * @param {import('../store.js').BrainPageRow | { meta: object, body?: string }} row
 */
function catalogMetaFromRow(row) {
  const meta = row.meta ?? row;
  return {
    path: String(meta.path ?? ''),
    title: String(meta.title ?? ''),
    status: meta.status != null ? String(meta.status) : undefined,
    tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t)) : [],
    summary: String(meta.summary ?? ''),
    links: Array.isArray(meta.links) ? meta.links.map((l) => String(l)) : [],
    similarTo: Array.isArray(meta.similarTo) ? meta.similarTo.map((s) => String(s)) : [],
  };
}

/**
 * Build a bounded wiki snapshot for LLM cleanup planning.
 * @param {{
 *   diagnostics: Record<string, unknown>,
 *   maxChars?: number,
 * }} input
 */
export async function buildWikiCleanupSnapshot(input) {
  const maxChars = normalizeMaxChars(input.maxChars);
  const diagnostics = input.diagnostics ?? {};

  const catalog = await loadCatalog();
  const pagesWithBodies = await loadAllPagesWithBodies();
  const diagnosticPaths = pathsFromDiagnostics(diagnostics);

  const schemaFull = await fs.readFile(getBrainSchemaPath(), 'utf8').catch(() => '');
  const indexFull = await fs.readFile(getBrainIndexPath(), 'utf8').catch(() => '');

  const schemaExcerpt = schemaFull.slice(0, SCHEMA_EXCERPT_CHARS);

  const catalogMeta = (catalog.pages.length > 0 ? catalog.pages : pagesWithBodies.map((p) => p.meta)).map(
    (p) => catalogMetaFromRow({ meta: p }),
  );

  const bodyByPath = new Map();
  for (const row of pagesWithBodies) {
    const rel = String(row.meta?.path ?? '').replace(/\\/g, '/');
    if (!rel) continue;
    bodyByPath.set(rel, String(row.body ?? ''));
  }

  /** @type {Record<string, { mode: 'full' | 'excerpt', text: string }>} */
  const bodies = {};

  const assignBody = (relPath, mode, text) => {
    const key = relPath.replace(/\\/g, '/');
    bodies[key] = { mode, text };
  };

  for (const meta of catalogMeta) {
    const fullText = bodyByPath.get(meta.path) ?? '';
    const needsFull =
      diagnosticPaths.has(meta.path) ||
      meta.path === 'index.md' ||
      meta.path.endsWith('/index.md');
    if (needsFull) {
      assignBody(meta.path, 'full', fullText);
    } else {
      const excerpt = fullText.slice(0, EXCERPT_CHARS);
      const prefix = meta.summary ? `${meta.summary}\n\n` : '';
      assignBody(meta.path, 'excerpt', `${prefix}${excerpt}`.trim());
    }
  }

  /** @type {Record<string, unknown>} */
  let snapshot = {
    generatedAt: new Date().toISOString(),
    pageCount: catalogMeta.length,
    diagnostics,
    schemaExcerpt,
    indexBody: indexFull,
    schemaBody: schemaFull,
    catalog: catalogMeta,
    bodies,
  };

  snapshot = trimSnapshotToBudget(snapshot, maxChars);
  const snapshotHash = hashSnapshot(snapshot);

  return { snapshot, snapshotHash, charCount: measureSnapshotChars(snapshot) };
}

/**
 * @param {Record<string, unknown>} snapshot
 */
function measureSnapshotChars(snapshot) {
  return JSON.stringify(snapshot).length;
}

/**
 * @param {Record<string, unknown>} snapshot
 */
function hashSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/**
 * Shrink snapshot JSON until it fits maxChars (preserve diagnostics + catalog metadata).
 * Drops non-diagnostic bodies first, then schema/index, then excerpts.
 * @param {Record<string, unknown>} snapshot
 * @param {number} maxChars
 */
function trimSnapshotToBudget(snapshot, maxChars) {
  let current = { ...snapshot };
  if (measureSnapshotChars(current) <= maxChars) {
    return current;
  }

  /** @type {Record<string, { mode: string, text: string }>} */
  const bodies = { ...(current.bodies ?? {}) };
  const diagnosticPaths = pathsFromDiagnostics(
    /** @type {Record<string, unknown>} */ (current.diagnostics ?? {}),
  );

  for (const [path, entry] of Object.entries(bodies)) {
    if (entry.mode !== 'full') continue;
    if (diagnosticPaths.has(path)) continue;
    if (path === 'index.md' || path.endsWith('/index.md')) continue;
    const meta = /** @type {Array<{ path: string, summary?: string }>} */ (current.catalog).find(
      (p) => p.path === path,
    );
    const excerptSource = entry.text.slice(0, EXCERPT_CHARS);
    const prefix = meta?.summary ? `${meta.summary}\n\n` : '';
    bodies[path] = { mode: 'excerpt', text: `${prefix}${excerptSource}`.trim() };
    current = { ...current, bodies };
    if (measureSnapshotChars(current) <= maxChars) return current;
  }

  const schemaBody = String(current.schemaBody ?? '');
  const indexBody = String(current.indexBody ?? '');
  let schemaSlice = Math.min(schemaBody.length, SCHEMA_EXCERPT_CHARS);
  let indexSlice = indexBody.length;
  while (measureSnapshotChars(current) > maxChars && (schemaSlice > 500 || indexSlice > 500)) {
    if (schemaSlice > 500) schemaSlice = Math.max(500, Math.floor(schemaSlice * 0.7));
    if (indexSlice > 500) indexSlice = Math.max(500, Math.floor(indexSlice * 0.7));
    current = {
      ...current,
      schemaBody: schemaBody.slice(0, schemaSlice),
      indexBody: indexBody.slice(0, indexSlice),
      schemaExcerpt: schemaBody.slice(0, Math.min(schemaSlice, SCHEMA_EXCERPT_CHARS)),
    };
  }

  let excerptLimit = EXCERPT_CHARS;
  while (measureSnapshotChars(current) > maxChars && excerptLimit > 80) {
    excerptLimit = Math.max(80, Math.floor(excerptLimit * 0.75));
    for (const [path, entry] of Object.entries(bodies)) {
      if (entry.mode === 'full' && diagnosticPaths.has(path)) continue;
      bodies[path] = {
        mode: entry.mode === 'full' ? 'full' : 'excerpt',
        text: entry.text.slice(0, excerptLimit),
      };
    }
    current = { ...current, bodies };
  }

  if (measureSnapshotChars(current) > maxChars) {
    for (const path of Object.keys(bodies)) {
      if (diagnosticPaths.has(path)) continue;
      delete bodies[path];
      current = { ...current, bodies };
      if (measureSnapshotChars(current) <= maxChars) break;
    }
  }

  return current;
}
