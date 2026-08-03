#!/usr/bin/env node
/**
 * Report production bundle sizes from dist/assets for CI and local perf budgets.
 * Usage: node scripts/report-bundle-size.mjs [--json] [--check]
 *
 * `--check` enforces budgets.json (same rules as check-performance-budgets.mjs).
 */

import {
  analyzeDistAssets,
  evaluateBundleBudgets,
  formatKb,
  loadBudgets,
} from './lib/analyze-dist-assets.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const check = args.includes('--check');

const analysis = analyzeDistAssets();
const budgets = loadBudgets();
const breaches = evaluateBundleBudgets(analysis, budgets);

const report = {
  generatedAt: new Date().toISOString(),
  entryChunk: analysis.entryJs
    ? {
        name: analysis.entryJs.name,
        bytes: analysis.entryJs.bytes,
        kb: analysis.entryJs.kb,
      }
    : null,
  entryCss: analysis.entryCss
    ? {
        name: analysis.entryCss.name,
        bytes: analysis.entryCss.bytes,
        kb: analysis.entryCss.kb,
      }
    : null,
  largestLazyJs: analysis.largestLazyJs,
  totals: analysis.totals,
  totalAssetsKb: analysis.totalAssetsKb,
  dataPackJsChunks: analysis.dataPackJsChunks,
  largestChunks: analysis.allFiles.slice(0, 15),
  budgets: budgets.bundle,
  withinBudget: breaches.length === 0,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Minnow bundle size report');
  console.log('========================');
  if (analysis.entryJs) {
    const ok = analysis.entryJs.kb <= budgets.bundle.entryJsMaxKb ? 'OK' : 'OVER';
    console.log(
      `Entry chunk: ${analysis.entryJs.name} — ${formatKb(analysis.entryJs.bytes)} [${ok} ≤ ${budgets.bundle.entryJsMaxKb} KB]`,
    );
  } else {
    console.log('Entry chunk: not found');
  }
  if (analysis.entryCss) {
    const ok = analysis.entryCss.kb <= budgets.bundle.entryCssMaxKb ? 'OK' : 'OVER';
    console.log(
      `Entry CSS: ${analysis.entryCss.name} — ${formatKb(analysis.entryCss.bytes)} [${ok} ≤ ${budgets.bundle.entryCssMaxKb} KB]`,
    );
  }
  if (analysis.largestLazyJs) {
    const ok =
      analysis.largestLazyJs.kb <= budgets.bundle.largestLazyJsMaxKb ? 'OK' : 'OVER';
    console.log(
      `Largest lazy JS: ${analysis.largestLazyJs.name} — ${formatKb(analysis.largestLazyJs.bytes)} [${ok} ≤ ${budgets.bundle.largestLazyJsMaxKb} KB]`,
    );
  }
  const totalOk = analysis.totalAssetsKb <= budgets.bundle.totalAssetsMaxKb ? 'OK' : 'OVER';
  console.log(
    `Total assets (excl. data packs): ${formatKb(analysis.totalAssetsBytes)} [${totalOk} ≤ ${budgets.bundle.totalAssetsMaxKb} KB]`,
  );
  console.log(`Data-pack JS chunks: ${analysis.dataPackJsChunks.length} (expect 0)`);
  console.log('\nLargest chunks:');
  for (const row of report.largestChunks) {
    console.log(`  ${formatKb(row.bytes).padStart(10)}  ${row.name}`);
  }
}

let exitCode = 0;
if (check) {
  if (breaches.length > 0) {
    for (const breach of breaches) {
      console.error(
        `Budget breach: ${breach.detail ?? breach.metric} — ${breach.actualKb} KB exceeds ${breach.limitKb} KB by ${breach.deltaKb} KB`,
      );
    }
    exitCode = 1;
  } else {
    console.log('All bundle budgets OK.');
  }
}

process.exit(check ? exitCode : 0);
