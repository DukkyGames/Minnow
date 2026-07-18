/**
 * Wiki health report — orphans, stale pages, link issues (no auto-edits).
 * MIN-B9 extends this with anchor-drift detection.
 */

import { llmCall } from '../research/llm.js';
import {
  findOrphanPages,
  listPages,
  loadCatalog,
  loadBrainConfig,
  updatePage,
  deletePage,
} from './store.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { detectAndApplyAnchorDrift } from './code/anchors.js';
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

/**
 * Collect pages explicitly marked stale or with stale status in frontmatter cache.
 * @param {Array<{ path: string, status?: string }>} pages
 */
export function findStalePages(pages) {
  return pages.filter((p) => p.status === 'stale');
}

/**
 * Detect wikilink targets that do not resolve to an existing page path.
 * @param {Array<{ path: string, links?: string[] }>} pages
 */
export function findMissingLinkTargets(pages) {
  const known = new Set();
  for (const page of pages) {
    const rel = page.path.replace(/\.md$/i, '');
    known.add(rel);
    known.add(page.path);
  }

  const missing = [];
  for (const page of pages) {
    for (const link of page.links ?? []) {
      const target = String(link).replace(/\\/g, '/');
      const asPath = target.endsWith('.md') ? target : `${target}.md`;
      if (!known.has(target) && !known.has(asPath)) {
        missing.push({
          from: page.path,
          target,
          summary: `[[${target}]] has no matching page`,
        });
      }
    }
  }
  return missing;
}

/**
 * Re-score every existing `similarTo` edge against the current linking floors and
 * strip the ones that no longer qualify.
 *
 * Cleanup for wikis written before the floors existed, when linking took the top
 * three pages with no minimum score at all. Pages marked `stale` are left alone:
 * their `similarTo` is a supersede pointer written by retirement, not a
 * similarity edge, and dropping it would lose the trail to the newer page.
 *
 * @param {{ dryRun?: boolean }} [opts] defaults to a dry run — pass `dryRun: false` to write
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
        // Points at a page that no longer exists (or at itself).
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
        /* best-effort */
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

/**
 * Optional LLM pass for contradictions (skipped when no model is available).
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
 * Run a structured wiki lint report.
 * When `apply: true`, marks orphan/stale pages and retires contradicted pages (conservative).
 * @param {{ includeLlm?: boolean, apply?: boolean }} [opts]
 */
export async function lintBrainWiki(opts = {}) {
  const anchorDrift = await detectAndApplyAnchorDrift();
  const catalog = await loadCatalog();
  const pages = catalog.pages.length > 0 ? catalog.pages : await listPages();
  const orphans = findOrphanPages({ pages });
  const stale = findStalePages(pages);
  const missingLinks = findMissingLinkTargets(pages);

  const contradictions =
    opts.includeLlm !== false
      ? await detectContradictionsWithLlm(pages)
      : [];

  const brainConfig = await loadBrainConfig();

  /** @type {{ path: string, action: string }[]} */
  const applied = [];

  if (opts.apply) {
    // Mark stale pages as orphan status if they have no inbound links (delete is too aggressive).
    for (const page of orphans) {
      if (page.status === 'stale') {
        try {
          await deletePage(page.path);
          applied.push({ path: page.path, action: 'deleted' });
        } catch {
          /* best-effort */
        }
      } else if (page.status !== 'orphan') {
        try {
          await updatePage(page.path, { status: 'stale' });
          applied.push({ path: page.path, action: 'marked-stale' });
        } catch {
          /* best-effort */
        }
      }
    }

    // For detected contradictions, mark the page listed second (assumed older) as stale.
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
        /* best-effort */
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
    anchorDrift: anchorDrift.map((d) => ({
      path: d.path,
      title: d.title,
      symbolIds: d.symbolIds,
      summary: `Anchored symbol(s) changed: ${d.symbolIds.join(', ')}`,
    })),
    missingLinks,
    contradictions,
    extensions: {
      anchorDrift: anchorDrift.length > 0 ? 'active' : 'ok',
    },
    embeddingsEnabled: brainConfig.embeddings?.enabled === true,
    ...(opts.apply ? { applied } : {}),
  };
}
