/**
 * Workspace-scoped brain retrieval — loads wiki pages, scopes, then calls the pure engine.
 */

import { bindRetrieveVectorStore, retrieveMemoryBlockHybrid } from '../engine/retrieve.js';
import { createVectorStore } from '../engine/vector-store.js';
import { getEnginePaths } from './engine-paths.js';
import { isValidPageId } from './paths.js';
import { listPages, readPage, loadBrainConfig } from './store.js';

const vectorStore = createVectorStore(getEnginePaths, { isValidEntryId: isValidPageId });
bindRetrieveVectorStore(vectorStore);

export * from '../engine/retrieve.js';

/**
 * Keep global pages and only the matching workspace subtree.
 * @param {Array<{ path: string }>} pages
 * @param {string} [workspaceKey]
 */
export function scopePagesToWorkspace(pages, workspaceKey) {
  const key = String(workspaceKey ?? '').trim().replace(/\\/g, '/');
  const workspacePrefix = key ? `workspaces/${key}/` : null;

  return pages.filter((page) => {
    const rel = String(page.path ?? '').replace(/\\/g, '/');
    if (!rel.startsWith('workspaces/')) {
      return true;
    }
    if (!workspacePrefix) {
      return false;
    }
    return rel.startsWith(workspacePrefix);
  });
}

/** Load every wiki page with body text for retrieval. */
export async function loadAllPagesWithBodies() {
  const metas = await listPages();
  const out = [];
  for (const meta of metas) {
    try {
      const row = await readPage(meta.path);
      out.push({ meta: row.meta, body: row.body });
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

/**
 * Hybrid retrieve over scoped wiki pages (workspace filter applied before engine call).
 * @param {{ query?: string, limit?: number, tags?: string[], maxChars?: number, workspaceKey?: string }} opts
 * @param {object} [brainConfig]
 */
export async function retrieveBrainBlockHybrid(opts = {}, brainConfig) {
  const config = brainConfig ?? (await loadBrainConfig());
  const all = await loadAllPagesWithBodies();
  const scopedMetas = scopePagesToWorkspace(
    all.map((row) => row.meta),
    opts.workspaceKey,
  );
  const scopedPaths = new Set(scopedMetas.map((m) => m.path));
  const entries = all.filter((row) => scopedPaths.has(row.meta.path));
  return retrieveMemoryBlockHybrid(entries, opts, config);
}
