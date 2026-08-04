#!/usr/bin/env node
/**
 * Shared dist/assets size analysis for report scripts and CI budget gates.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '../..');
export const DIST_ASSETS = path.join(REPO_ROOT, 'dist/assets');
export const DIST_INDEX_HTML = path.join(REPO_ROOT, 'dist/index.html');
export const BUDGETS_PATH = path.join(REPO_ROOT, 'budgets.json');
export const BASELINE_PATH = path.join(REPO_ROOT, 'scripts/bundle-size-baseline.json');

/** @typedef {{ name: string, bytes: number, kb: number }} AssetRow */
/** @typedef {{ entryJs: AssetRow | null, entryCss: AssetRow | null, largestLazyJs: AssetRow | null, eagerJs: AssetRow | null, totalAssetsBytes: number, dataPackJsChunks: AssetRow[], allFiles: AssetRow[] }} DistAnalysis */

export function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function kbFromBytes(bytes) {
  return Number((bytes / 1024).toFixed(1));
}

export function isEntryJs(name) {
  return /^index-[^/]+\.js$/.test(name);
}

export function isEntryCss(name) {
  return /^index-[^/]+\.css$/.test(name);
}

export function isVendorJs(name) {
  return /^vendor-/.test(name);
}

export function isDataPackChunk(name) {
  return /(mmlu|gsm8k|arc-challenge|truthfulqa|humaneval)-mini-[^/]+\.js$/.test(name);
}

/**
 * Resolve a dist/index.html script or modulepreload href to a basename under dist/assets.
 * @param {string} href
 */
export function assetBasenameFromHref(href) {
  if (!href || typeof href !== 'string') return null;
  const cleaned = href.split('?')[0].split('#')[0];
  const parts = cleaned.replace(/\\/g, '/').split('/');
  const name = parts[parts.length - 1];
  if (!name || !name.endsWith('.js')) return null;
  return name;
}

/**
 * Parse dist/index.html for the entry module script + every rel=modulepreload href.
 * Those are the bytes the browser fetches before first interaction on a cold boot.
 * @param {string} indexHtmlPath
 * @returns {string[]} unique asset basenames
 */
export function parseEagerJsHrefsFromIndexHtml(indexHtmlPath = DIST_INDEX_HTML) {
  const html = readFileSync(indexHtmlPath, 'utf8');
  /** @type {Set<string>} */
  const names = new Set();

  // Entry: <script type="module" … src="…">
  for (const match of html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/gi,
  )) {
    const tag = match[0];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const name = assetBasenameFromHref(src?.[1] ?? '');
    if (name) names.add(name);
  }

  // Vite also emits <link rel="modulepreload" href="…">
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["'][^"']*modulepreload[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const name = assetBasenameFromHref(href?.[1] ?? '');
    if (name) names.add(name);
  }

  return [...names];
}

/**
 * Sum byte sizes for the eager JS set declared by dist/index.html.
 * @param {AssetRow[]} jsFiles
 * @param {string[]} eagerNames
 * @returns {AssetRow | null}
 */
export function sumEagerJs(jsFiles, eagerNames) {
  if (!eagerNames.length) return null;
  const byName = new Map(jsFiles.map((f) => [f.name, f]));
  let bytes = 0;
  /** @type {string[]} */
  const found = [];
  for (const name of eagerNames) {
    const row = byName.get(name);
    if (!row) continue;
    bytes += row.bytes;
    found.push(name);
  }
  if (found.length === 0) return null;
  return {
    name: `eager(${found.length} chunks)`,
    bytes,
    kb: kbFromBytes(bytes),
  };
}

/** List hashed JS/CSS assets under dist/assets. */
export function listDistAssetFiles(distAssets = DIST_ASSETS) {
  const distDir = path.join(REPO_ROOT, 'dist');
  if (!statSync(distDir, { throwIfNoEntry: false })) {
    throw new Error('dist/ not found — run `npm run build` first.');
  }
  return readdirSync(distAssets)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => {
      const file = path.join(distAssets, name);
      const bytes = statSync(file).size;
      return { name, bytes, kb: kbFromBytes(bytes) };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

/** Compute budget metrics from a dist/assets listing. */
export function analyzeDistAssets(distAssets = DIST_ASSETS) {
  const allFiles = listDistAssetFiles(distAssets);
  const jsFiles = allFiles.filter((f) => f.name.endsWith('.js'));
  const cssFiles = allFiles.filter((f) => f.name.endsWith('.css'));
  const dataPackJsChunks = jsFiles.filter((f) => isDataPackChunk(f.name));
  const entryJs = jsFiles.find((f) => isEntryJs(f.name)) ?? null;
  const entryCss = cssFiles.find((f) => isEntryCss(f.name)) ?? null;

  const lazyCandidates = jsFiles.filter(
    (f) => !isEntryJs(f.name) && !isVendorJs(f.name) && !isDataPackChunk(f.name),
  );
  const largestLazyJs = lazyCandidates[0] ?? null;

  const totalJs = jsFiles.reduce((sum, f) => sum + f.bytes, 0);
  const totalCss = cssFiles.reduce((sum, f) => sum + f.bytes, 0);
  const dataPackBytes = dataPackJsChunks.reduce((sum, f) => sum + f.bytes, 0);
  const totalAssetsBytes = totalJs + totalCss - dataPackBytes;

  // Eager JS = entry module + every modulepreload in dist/index.html (cold-boot cost).
  let eagerJs = null;
  try {
    const eagerNames = parseEagerJsHrefsFromIndexHtml(DIST_INDEX_HTML);
    eagerJs = sumEagerJs(jsFiles, eagerNames);
  } catch {
    eagerJs = null;
  }

  return {
    entryJs,
    entryCss,
    largestLazyJs,
    eagerJs,
    totalAssetsBytes,
    totalAssetsKb: kbFromBytes(totalAssetsBytes),
    dataPackJsChunks,
    allFiles,
    totals: {
      jsBytes: totalJs,
      cssBytes: totalCss,
      jsKb: kbFromBytes(totalJs),
      cssKb: kbFromBytes(totalCss),
    },
  };
}

/** Load budgets.json from the repo root. */
export function loadBudgets() {
  const raw = readFileSync(BUDGETS_PATH, 'utf8');
  return JSON.parse(raw);
}

/** Load committed baseline snapshot for diff output. */
export function loadBaseline() {
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Compare analysis against budgets; returns breach rows for CI.
 * @param {DistAnalysis} analysis
 * @param {{ bundle: Record<string, number> }} budgets
 */
export function evaluateBundleBudgets(analysis, budgets) {
  /** @type {{ metric: string, actualKb: number, limitKb: number, deltaKb: number, detail?: string }[]} */
  const breaches = [];

  const checks = [
    {
      metric: 'entryJs',
      label: 'Entry JS',
      row: analysis.entryJs,
      limitKb: budgets.bundle.entryJsMaxKb,
    },
    {
      metric: 'entryCss',
      label: 'Entry CSS',
      row: analysis.entryCss,
      limitKb: budgets.bundle.entryCssMaxKb,
    },
    {
      metric: 'largestLazyJs',
      label: 'Largest lazy JS',
      row: analysis.largestLazyJs,
      limitKb: budgets.bundle.largestLazyJsMaxKb,
    },
    {
      metric: 'eagerJs',
      label: 'Eager JS (entry + modulepreload)',
      row: analysis.eagerJs,
      limitKb: budgets.bundle.eagerJsMaxKb,
    },
    {
      metric: 'totalAssets',
      label: 'Total dist/assets (excl. data packs)',
      row: { kb: analysis.totalAssetsKb, name: 'dist/assets' },
      limitKb: budgets.bundle.totalAssetsMaxKb,
    },
  ];

  for (const check of checks) {
    // eagerJsMaxKb is optional until budgets.json is updated; skip if unset.
    if (check.metric === 'eagerJs' && typeof check.limitKb !== 'number') continue;
    if (!check.row) {
      breaches.push({
        metric: check.metric,
        actualKb: 0,
        limitKb: check.limitKb,
        deltaKb: check.limitKb,
        detail: `${check.label}: asset missing`,
      });
      continue;
    }
    const actualKb = check.row.kb;
    if (actualKb > check.limitKb) {
      breaches.push({
        metric: check.metric,
        actualKb,
        limitKb: check.limitKb,
        deltaKb: Number((actualKb - check.limitKb).toFixed(1)),
        detail: `${check.label} ${check.row.name} — ${formatKb(check.row.bytes ?? actualKb * 1024)}`,
      });
    }
  }

  if (analysis.dataPackJsChunks.length > 0) {
    breaches.push({
      metric: 'dataPackJs',
      actualKb: analysis.dataPackJsChunks.reduce((s, f) => s + f.kb, 0),
      limitKb: 0,
      deltaKb: analysis.dataPackJsChunks.length,
      detail: `Benchmark data packs must not ship as JS (${analysis.dataPackJsChunks.length} chunk(s))`,
    });
  }

  return breaches;
}

/** Format baseline diff for a metric key. */
export function baselineDeltaKb(metricKey, actualKb, baseline) {
  const base = baseline?.metrics?.[metricKey];
  if (typeof base !== 'number') return null;
  return Number((actualKb - base).toFixed(1));
}
