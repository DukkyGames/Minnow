#!/usr/bin/env node
/**
 * CI gate: enforce budgets.json bundle ceilings after `vite build`.
 * Usage: node scripts/check-performance-budgets.mjs [--update-baseline]
 */

import { writeFileSync } from 'node:fs';
import {
  analyzeDistAssets,
  baselineDeltaKb,
  evaluateBundleBudgets,
  formatKb,
  loadBaseline,
  loadBudgets,
  BASELINE_PATH,
} from './lib/analyze-dist-assets.mjs';

const updateBaseline = process.argv.includes('--update-baseline');

const budgets = loadBudgets();
const analysis = analyzeDistAssets();
const baseline = loadBaseline();
const breaches = evaluateBundleBudgets(analysis, budgets);

const metrics = {
  entryJsKb: analysis.entryJs?.kb ?? 0,
  entryCssKb: analysis.entryCss?.kb ?? 0,
  largestLazyJsKb: analysis.largestLazyJs?.kb ?? 0,
  eagerJsKb: analysis.eagerJs?.kb ?? 0,
  totalAssetsKb: analysis.totalAssetsKb,
};

if (updateBaseline) {
  const next = {
    generatedAt: new Date().toISOString(),
    metrics,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log('Updated scripts/bundle-size-baseline.json');
  process.exit(0);
}

console.log('Performance bundle budgets');
console.log('==========================');
for (const [label, key, row] of [
  ['Entry JS', 'entryJsKb', analysis.entryJs],
  ['Entry CSS', 'entryCssKb', analysis.entryCss],
  ['Largest lazy JS', 'largestLazyJsKb', analysis.largestLazyJs],
  ['Eager JS (entry + modulepreload)', 'eagerJsKb', analysis.eagerJs],
  [
    'Total assets',
    'totalAssetsKb',
    { name: 'dist/assets', kb: analysis.totalAssetsKb, bytes: analysis.totalAssetsBytes },
  ],
]) {
  if (!row) {
    console.log(`${label}: missing`);
    continue;
  }
  const vsBase = baselineDeltaKb(key, row.kb, baseline);
  const baseSuffix =
    vsBase == null ? '' : ` (${vsBase >= 0 ? '+' : ''}${vsBase} KB vs baseline)`;
  console.log(`${label}: ${formatKb(row.bytes)} ${row.name ?? ''}${baseSuffix}`);
}

if (breaches.length === 0) {
  console.log('\nAll bundle budgets OK.');
  process.exit(0);
}

console.error('\nBundle budget breach(es):');
for (const breach of breaches) {
  const vsBase = baselineDeltaKb(
    breach.metric === 'entryJs'
      ? 'entryJsKb'
      : breach.metric === 'entryCss'
        ? 'entryCssKb'
        : breach.metric === 'largestLazyJs'
          ? 'largestLazyJsKb'
          : breach.metric === 'eagerJs'
            ? 'eagerJsKb'
            : breach.metric === 'totalAssets'
              ? 'totalAssetsKb'
              : null,
    breach.actualKb,
    baseline,
  );
  const basePart =
    vsBase == null ? '' : `; ${vsBase >= 0 ? '+' : ''}${vsBase} KB vs committed baseline`;
  console.error(
    `  ${breach.detail ?? breach.metric}: ${breach.actualKb} KB > ${breach.limitKb} KB (+${breach.deltaKb} KB)${basePart}`,
  );
}

process.exit(1);
