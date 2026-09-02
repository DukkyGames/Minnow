import { llmCall } from '../research/llm.js';
import {
  findOrphanPages,
  listPages,
  loadCatalog,
  loadBrainConfig,
  updatePage,
  deletePage,
  resolvePageKeyInCatalog,
} from './store.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { detectAnchorDrift, detectAndApplyAnchorDrift } from './code/anchors.js';
import { loadAllPagesWithBodies } from './retrieve.js';
import { scorePagesByCosine, titleKeywords } from './synthesis.js';
import { normalizeLinkingConfig } from './linking-config.js';

const LINT_SYSTEM_PROMPT = `You review a personal wiki for contradictions and broken wikilinks.

Given catalog metadata and candidate issues, return JSON:
{
  "contradictions": [{ "pages": ["path/a.md", "path/b.md"], "summary": "..." }],
  "missingLinks": [{ "from": "path/a.md", "target": "missing-slug", "summary": "..." }]
}

Be conservative. Return ONLY valid JSON.`;

export const WIKI_ORPHAN_DEFINITION =
  'A page is an orphan when it has no inbound wikilinks, is not connected via similarTo edges to any other page, is not index.md, or is explicitly marked status orphan. Pages only linked through similarTo count as connected even without inbound wikilinks.';

/**
 * @param {Array<{ path: string, status?: string }>} pages
 */
export function findStalePages(pages) {
  return pages.filter((p) => p.status === 'stale');
}

/**
 * @param {Array<{ id?: string, path: string, links?: string[] }>} pages
 */
export function findMissingLinkTargets(pages) {
  const missing = [];
  for (const page of pages) {
    for (const link of page.links ?? []) {
      const target = String(link).replace(/\\/g, '/');
      const resolved = resolvePageKeyInCatalog(target, pages);
      if (resolved === 'missing') {
        missing.push({
          from: page.path,
          target,
          summary: `[[${target}]] has no matching page`,
        });
      } else if (resolved === 'ambiguous') {
        missing.push({
          from: page.path,
          target,
          summary: `[[${target}]] is ambiguous — use a full page path`,
        });
      }
    }
  }
  return missing;
}

/**
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ generatedAt: string, dryRun: boolean, pagesScanned: number, edgesScanned: number, removals: Array<{ path: string, dropped: string[], kept: string[] }>, applied: string[] }>}
 */
export async function pruneWeakSimilarLinks(opts = {}) {
  const dryRun = opts.dryRun !== false;
  const brainConfig = await loadBrainConfig();
  const { minSharedTitleKeywords, minCosine, maxLinks } = normalizeLinkingConfig(
    brainConfig.linking,
  );

  const pages = await loadAllPagesWithBodies();
  /** @type {Array<{ path: string, dropped: string[], kept: string[] }>} */
  const removals = [];
  /** @type {string[]} */
  const applied = [];
  let edgesScanned = 0;

  for (const row of pages) {
    const relPath = row.meta?.path;
    const similarTo = Array.isArray(row.meta?.similarTo) ? row.meta.similarTo : [];
    if (!relPath || similarTo.length === 0) continue;
    if (row.meta.status === 'stale') continue;

    edgesScanned += similarTo.length;

    const targets = pages.filter(
      (p) => p.meta?.path && p.meta.path !== relPath && similarTo.includes(p.meta.path),
    );
    const cosines = await scorePagesByCosine(
      `${row.meta.title ?? ''} ${row.body ?? ''}`.trim(),
      targets,
      brainConfig,
    );

    const kNew = titleKeywords(row.meta.title);
    /** @type {Array<{ path: string, score: number }>} */
    const qualified = [];
    /** @type {string[]} */
    const dropped = [];

    for (const target of similarTo) {
      const match = targets.find((p) => p.meta.path === target);
      if (!match) {
        dropped.push(target);
        continue;
      }
      const kOld = titleKeywords(match.meta.title);
      let shared = 0;
      for (const k of kNew) if (kOld.has(k)) shared++;
      const cosine = cosines.get(match.meta.id) ?? 0;
      if (shared < minSharedTitleKeywords && cosine < minCosine) {
        dropped.push(target);
        continue;
      }
      qualified.push({ path: target, score: shared + 2 * cosine });
    }

    const kept = qualified
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLinks)
      .map((entry) => entry.path);
    for (const entry of qualified) {
      if (!kept.includes(entry.path)) dropped.push(entry.path);
    }

    if (dropped.length === 0) continue;
    removals.push({ path: relPath, dropped, kept });

    if (!dryRun) {
      try {
        await updatePage(relPath, { similarTo: kept });
        applied.push(relPath);
      } catch {
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun,
    pagesScanned: pages.length,
    edgesScanned,
    removals,
    applied,
  };
}

function mapAnchorDriftForReport(drifted) {
  return drifted.map((d) => ({
    pageId: d.pageId,
    path: d.path,
    title: d.title,
    symbolIds: d.symbolIds,
    summary: `Anchored symbol(s) changed: ${d.symbolIds.join(', ')}`,
  }));
}

/**
 * @param {Record<string, never>} [_opts]
 */
export async function collectWikiDiagnostics(_opts = {}) {
  const catalog = await loadCatalog();
  const pages = catalog.pages.length > 0 ? catalog.pages : await listPages();
  const orphans = findOrphanPages({ pages });
  const stale = findStalePages(pages);
  const missingLinks = findMissingLinkTargets(pages);
  const anchorDrift = await detectAnchorDrift();
  const weakSimilarLinks = await pruneWeakSimilarLinks({ dryRun: true });
  const brainConfig = await loadBrainConfig();

  return {
    generatedAt: new Date().toISOString(),
    pageCount: pages.length,
    definitions: {
      orphans: WIKI_ORPHAN_DEFINITION,
    },
    orphans: orphans.map((p) => ({
      path: p.path,
      title: p.title,
      status: p.status,
    })),
    stale: stale.map((p) => ({
      path: p.path,
      title: p.title,
      status: p.status,
    })),
    missingLinks,
    anchorDrift: mapAnchorDriftForReport(anchorDrift),
    weakSimilarLinks: {
      dryRun: true,
      pagesScanned: weakSimilarLinks.pagesScanned,
      edgesScanned: weakSimilarLinks.edgesScanned,
      removals: weakSimilarLinks.removals,
    },
    embeddingsEnabled: brainConfig.embeddings?.enabled === true,
  };
}

/**
 * @param {object[]} pages
 */
async function detectContradictionsWithLlm(pages) {
  const cfg = await loadSynthesisConfig();
  const modelBinding = await resolveSynthesisModel(cfg);
  if (!modelBinding?.providerId || !modelBinding?.model) {
    return [];
  }

  const sample = pages.slice(0, 40).map((p) => ({
    path: p.path,
    title: p.title,
    summary: p.summary,
    tags: p.tags,
  }));

  const raw = await llmCall({
    providerId: modelBinding.providerId,
    model: modelBinding.model,
    messages: [
      { role: 'system', content: LINT_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ pages: sample }) },
    ],
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 45_000,
  });

  try {
    const parsed = JSON.parse(String(raw ?? '{}').trim());
    return Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ includeLlm?: boolean, apply?: boolean }} [opts]
 */
export async function lintBrainWiki(opts = {}) {
  const anchorDriftApplied = await detectAndApplyAnchorDrift();
  const catalog = await loadCatalog();
  const pages = catalog.pages.length > 0 ? catalog.pages : await listPages();
  const orphans = findOrphanPages({ pages });
  const stale = findStalePages(pages);
  const missingLinks = findMissingLinkTargets(pages);

  const contradictions =
    opts.includeLlm === true
      ? await detectContradictionsWithLlm(pages)
      : [];

  const brainConfig = await loadBrainConfig();

  /** @type {{ path: string, action: string }[]} */
  const applied = [];

  if (opts.apply) {
    for (const page of orphans) {
      if (page.status === 'stale') {
        try {
          await deletePage(page.path);
          applied.push({ path: page.path, action: 'deleted' });
        } catch {
        }
      } else if (page.status !== 'orphan') {
        try {
          await updatePage(page.path, { status: 'stale' });
          applied.push({ path: page.path, action: 'marked-stale' });
        } catch {
        }
      }
    }

    for (const contradiction of contradictions) {
      const pagePaths = Array.isArray(contradiction.pages) ? contradiction.pages : [];
      const target = pagePaths[1] ?? pagePaths[0];
      if (!target) continue;
      const page = pages.find((p) => p.path === target || p.path === `${target}.md`);
      if (!page || page.status === 'stale') continue;
      try {
        await updatePage(page.path, { status: 'stale' });
        applied.push({ path: page.path, action: 'marked-stale-contradiction' });
      } catch {
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    pageCount: pages.length,
    orphans: orphans.map((p) => ({
      path: p.path,
      title: p.title,
      status: p.status,
    })),
    stale: stale.map((p) => ({
      path: p.path,
      title: p.title,
      status: p.status,
    })),
    anchorDrift: mapAnchorDriftForReport(anchorDriftApplied),
    missingLinks,
    contradictions,
    extensions: {
      anchorDrift: anchorDriftApplied.length > 0 ? 'active' : 'ok',
    },
    embeddingsEnabled: brainConfig.embeddings?.enabled === true,
    ...(opts.apply ? { applied } : {}),
  };
}
