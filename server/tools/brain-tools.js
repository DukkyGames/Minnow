/**
 * Agent-facing Brain wiki tools — search, read, list, write, log, and ingest.
 */

import { ingestSource } from '../brain/ingest.js';
import { retrieveBrainBlockHybrid } from '../brain/retrieve.js';
import { brainWorkspaceKeyFromPath } from '../brain/paths.js';
import {
  appendLog,
  createPage,
  getPageTree,
  loadBrainConfig,
  readPage,
  updatePage,
} from '../brain/store.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

/** Resolve workspace key for scoped wiki retrieve/write. */
function activeWorkspaceKey() {
  return brainWorkspaceKeyFromPath(getEffectiveWorkspaceRoot());
}

/**
 * Semantic/hybrid search over the wiki (workspace-scoped).
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolBrainSearch(args) {
  const brain = await loadBrainConfig();
  if (brain.enabled === false) {
    return 'Error: Brain wiki is disabled in Settings → Memory.';
  }

  const query = String(args?.query ?? '').trim();
  if (!query) {
    return 'Error: query is required.';
  }

  const limit = typeof args?.limit === 'number' ? Math.min(20, Math.max(1, args.limit)) : 8;
  const tags = Array.isArray(args?.tags)
    ? args.tags.map((t) => String(t).trim()).filter(Boolean)
    : undefined;

  const { block, ids } = await retrieveBrainBlockHybrid(
    {
      query,
      limit,
      tags,
      maxChars: brain.maxInjectCharsFull ?? 4000,
      workspaceKey: activeWorkspaceKey(),
    },
    brain,
  );

  if (!block.trim()) {
    return 'No matching wiki pages found.';
  }

  const idLine = ids.length ? `\n\nMatched page ids: ${ids.join(', ')}` : '';
  return `${block.trim()}${idLine}`;
}

/**
 * Read one wiki page by relative path under pages/.
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolBrainReadPage(args) {
  const brain = await loadBrainConfig();
  if (brain.enabled === false) {
    return 'Error: Brain wiki is disabled in Settings → Memory.';
  }

  const relPath = String(args?.path ?? '').trim().replace(/\\/g, '/');
  if (!relPath) {
    return 'Error: path is required (e.g. facts/preference.md).';
  }

  const page = await readPage(relPath);
  const tags = (page.meta.tags ?? []).join(', ') || 'none';
  return [
    `# ${page.meta.title}`,
    `path: ${page.path}`,
    `id: ${page.meta.id}`,
    `tags: ${tags}`,
    `source: ${page.meta.source ?? 'user'}`,
    '',
    page.body.trim() || '(empty body)',
  ].join('\n');
}

/**
 * List the wiki page tree (metadata only).
 * @param {Record<string, unknown>} [_args]
 * @returns {Promise<string>}
 */
export async function toolBrainList(_args) {
  const brain = await loadBrainConfig();
  if (brain.enabled === false) {
    return 'Error: Brain wiki is disabled in Settings → Memory.';
  }

  const tree = await getPageTree();
  return JSON.stringify(tree, null, 2);
}

/**
 * Create or update a wiki page (frontmatter + body).
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolBrainWritePage(args) {
  const brain = await loadBrainConfig();
  if (brain.enabled === false) {
    return 'Error: Brain wiki is disabled in Settings → Memory.';
  }

  const relPath = String(args?.path ?? '').trim().replace(/\\/g, '/');
  const title = String(args?.title ?? '').trim();
  const body = String(args?.body ?? '').trim();

  if (!relPath) {
    return 'Error: path is required (e.g. facts/preference.md or edgeflight/overview.md).';
  }
  if (!title) {
    return 'Error: title is required.';
  }
  if (!body) {
    return 'Error: body is required.';
  }

  const tags = Array.isArray(args?.tags)
    ? args.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const summary = args?.summary !== undefined ? String(args.summary) : undefined;

  let exists = true;
  try {
    await readPage(relPath);
  } catch {
    exists = false;
  }

  if (exists) {
    const updated = await updatePage(relPath, { title, body, tags, summary, source: 'agent' });
    return `Updated wiki page "${updated.meta.title}" at ${updated.path} (id: ${updated.meta.id}).`;
  }

  const created = await createPage({
    relPath,
    title,
    body,
    tags,
    summary,
    source: 'agent',
  });
  return `Created wiki page "${created.meta.title}" at ${created.path} (id: ${created.meta.id}).`;
}

/**
 * Append a line to brain log.md (changelog).
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolBrainAppendLog(args) {
  const brain = await loadBrainConfig();
  if (brain.enabled === false) {
    return 'Error: Brain wiki is disabled in Settings → Memory.';
  }

  const entry = String(args?.entry ?? args?.message ?? '').trim();
  if (!entry) {
    return 'Error: entry is required.';
  }

  await appendLog(entry);
  return 'Appended to brain log.md.';
}

/**
 * Ingest a non-code source into immutable sources/ + synthesized wiki pages.
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolBrainIngestSource(args) {
  const brain = await loadBrainConfig();
  if (brain.enabled === false) {
    return 'Error: Brain wiki is disabled in Settings → Memory.';
  }

  const content = String(args?.content ?? '').trim();
  if (!content) {
    return 'Error: content is required.';
  }

  try {
    const result = await ingestSource({
      content,
      filename: args?.filename !== undefined ? String(args.filename) : undefined,
      title: args?.title !== undefined ? String(args.title) : undefined,
    });
    const paths = Array.isArray(result?.paths) ? result.paths : [];
    if (!paths.length) {
      return 'Ingest completed but no wiki pages were created.';
    }
    return `Ingested source into ${paths.length} page(s): ${paths.join(', ')}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error ingesting source: ${message}`;
  }
}
