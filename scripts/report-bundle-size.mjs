#!/usr/bin/env node
/**
 * Report production bundle sizes from dist/assets for CI and local perf budgets.
 * Usage: node scripts/report-bundle-size.mjs [--json] [--fail-over-kb <n>]
 *
 * Exit 1 when --fail-over-kb is set and the entry chunk exceeds the limit.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = path.join(__dirname, '../dist/assets');
const ENTRY_BUDGET_KB = 1500;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failIdx = args.indexOf('--fail-over-kb');
const failOverKb = failIdx >= 0 ? Number(args[failIdx + 1]) : null;

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function isEntryChunk(name) {
  return /^index-[^/]+\.js$/.test(name);
}

function isDataPackChunk(name) {
  return /(mmlu|gsm8k|arc-challenge|truthfulqa|humaneval)-mini-[^/]+\.js$/.test(name);
}

function listAssetFiles() {
  if (!statSync(path.join(__dirname, '../dist'), { throwIfNoEntry: false })) {
    console.error('dist/ not found — run `npm run build` first.');
    process.exit(1);
  }
  return readdirSync(DIST_ASSETS)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => {
      const file = path.join(DIST_ASSETS, name);
      const bytes = statSync(file).size;
      return { name, bytes };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

const files = listAssetFiles();
const totalJs = files.filter((f) => f.name.endsWith('.js')).reduce((sum, f) => sum + f.bytes, 0);
const totalCss = files.filter((f) => f.name.endsWith('.css')).reduce((sum, f) => sum + f.bytes, 0);
const entry = files.find((f) => isEntryChunk(f.name) && f.name.endsWith('.js'));
const dataPackChunks = files.filter((f) => isDataPackChunk(f.name));

const report = {
  generatedAt: new Date().toISOString(),
  distAssets: DIST_ASSETS,
  entryChunk: entry
    ? { name: entry.name, bytes: entry.bytes, kb: Number((entry.bytes / 1024).toFixed(1)) }
    : null,
  totals: {
    jsBytes: totalJs,
    cssBytes: totalCss,
    jsKb: Number((totalJs / 1024).toFixed(1)),
    cssKb: Number((totalCss / 1024).toFixed(1)),
  },
  dataPackJsChunks: dataPackChunks.map((f) => ({
    name: f.name,
    bytes: f.bytes,
    kb: Number((f.bytes / 1024).toFixed(1)),
  })),
  largestChunks: files.slice(0, 15).map((f) => ({
    name: f.name,
    bytes: f.bytes,
    kb: Number((f.bytes / 1024).toFixed(1)),
  })),
  budgets: {
    entryChunkMaxKb: ENTRY_BUDGET_KB,
    entryWithinBudget: entry ? entry.bytes / 1024 <= ENTRY_BUDGET_KB : false,
    noDataPackJsChunks: dataPackChunks.length === 0,
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Minnow bundle size report');
  console.log('========================');
  if (entry) {
    const ok = entry.bytes / 1024 <= ENTRY_BUDGET_KB ? 'OK' : 'OVER';
    console.log(`Entry chunk: ${entry.name} — ${formatKb(entry.bytes)} [${ok} ≤ ${ENTRY_BUDGET_KB} KB]`);
  } else {
    console.log('Entry chunk: not found');
  }
  console.log(`Total JS: ${formatKb(totalJs)} | Total CSS: ${formatKb(totalCss)}`);
  console.log(`Data-pack JS chunks: ${dataPackChunks.length} (expect 0)`);
  console.log('\nLargest chunks:');
  for (const row of report.largestChunks) {
    console.log(`  ${formatKb(row.bytes).padStart(10)}  ${row.name}`);
  }
}

let exitCode = 0;
if (failOverKb != null && entry && entry.bytes / 1024 > failOverKb) {
  console.error(`Entry chunk ${formatKb(entry.bytes)} exceeds budget ${failOverKb} KB`);
  exitCode = 1;
}
if (dataPackChunks.length > 0) {
  console.error(`Found ${dataPackChunks.length} benchmark data pack JS chunk(s) — packs should be static JSON under public/`);
  exitCode = 1;
}

process.exit(exitCode);
