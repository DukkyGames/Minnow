#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const [, , datasetId, outPath] = process.argv;

if (!datasetId || !outPath) {
  console.error('Usage: node scripts/fetch-benchmark-dataset.mjs <hf-dataset-id> <output.json>');
  process.exit(1);
}

console.log(`Fetch ${datasetId} manually from https://huggingface.co/datasets/${datasetId}`);
console.log('Convert to Minnow StandardBenchmarkPack JSON schema, then import via Benchmark → Tests.');

const stub = {
  id: datasetId.replace(/\//g, '-'),
  label: datasetId,
  category: 'reasoning',
  description: `Imported from HuggingFace dataset ${datasetId}`,
  scoring: 'mcq',
  miniCount: 0,
  items: [],
};

writeFileSync(outPath, JSON.stringify(stub, null, 2));
console.log(`Wrote stub template to ${outPath}`);
