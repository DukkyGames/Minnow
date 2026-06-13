#!/usr/bin/env node
/**
 * Fetch standard benchmark datasets from Hugging Face and write bundled full-tier packs.
 * Usage: node scripts/build-benchmark-packs.mjs [--only mmlu,gsm8k] [--force]
 *
 * Output: src/benchmark/standard/packs/full/*.json
 * Requires network access to huggingface.co and datasets-server.huggingface.co
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../src/benchmark/standard/packs/full');
const MINI_DIR = path.join(__dirname, '../src/benchmark/standard/packs');
const HF_PARQUET = 'https://datasets-server.huggingface.co/parquet';
const REQUEST_DELAY_MS = 150;

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice(7)
  ?? (args.includes('--only') ? args[args.indexOf('--only') + 1] : null);
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** List parquet file descriptors for a Hugging Face dataset. */
async function listParquetFiles(dataset) {
  const res = await fetch(`${HF_PARQUET}?dataset=${encodeURIComponent(dataset)}`);
  if (!res.ok) throw new Error(`parquet list ${dataset} HTTP ${res.status}`);
  const data = await res.json();
  return data.parquet_files ?? [];
}

/** Download and parse one parquet file into row objects. */
async function readParquetUrl(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const file = await asyncBufferFromUrl({ url });
      return parquetReadObjects({ file });
    } catch (err) {
      const wait = 1000 * (attempt + 1);
      console.warn(`  parquet fetch failed (attempt ${attempt + 1}): ${err instanceof Error ? err.message : err}`);
      if (attempt >= 5) throw err;
      await sleep(wait);
    }
  }
  return [];
}

function letterFromIndex(index) {
  return String.fromCharCode(65 + index);
}

function formatMcqPrompt(question, choices) {
  const lines = choices.map((c, i) => `${letterFromIndex(i)}) ${c}`);
  return `${question}\n${lines.join('\n')}\nAnswer with the letter only.`;
}

function extractGsmAnswer(raw) {
  const hash = raw.match(/####\s*(-?\d+(?:\.\d+)?)/);
  if (hash) return hash[1];
  const nums = raw.match(/-?\d+(?:\.\d+)?/g);
  return nums ? nums[nums.length - 1] : '';
}

function writePack(filename, pack, outDir = OUT_DIR) {
  const outPath = path.join(outDir, filename);
  if (!force && existsSync(outPath)) {
    console.log(`  skip ${filename} (exists; use --force to overwrite)`);
    return;
  }
  writeFileSync(outPath, JSON.stringify(pack, null, 0));
  const kb = (JSON.stringify(pack).length / 1024).toFixed(1);
  console.log(`  wrote ${filename} (${pack.items.length} items, ${kb} KB)`);
}

function shouldBuild(key) {
  return !only || only.has(key);
}

async function buildMmlu() {
  if (!shouldBuild('mmlu')) return;
  console.log('Building MMLU full…');
  const files = await listParquetFiles('cais/mmlu');
  const allTest = files.find((f) => f.config === 'all' && f.split === 'test');
  if (!allTest) throw new Error('MMLU all/test parquet not found');
  const rows = await readParquetUrl(allTest.url);
  const items = [];
  for (const row of rows) {
    const choices = row.choices ?? [];
    const answerIdx = Number(row.answer);
    if (!choices.length || Number.isNaN(answerIdx) || answerIdx < 0 || answerIdx >= choices.length) {
      continue;
    }
    const subject = row.subject ?? 'general';
    items.push({
      id: `mmlu-${subject}-${items.length + 1}`,
      prompt: formatMcqPrompt(row.question, choices),
      choices,
      groundTruth: letterFromIndex(answerIdx),
      category: 'reasoning',
      metadata: { source: 'MMLU', tier: 'full', subject },
    });
  }
  console.log(`  all/test: ${items.length}`);
  writePack('mmlu-mini.json', {
    id: 'mmlu-mini',
    label: 'MMLU',
    category: 'reasoning',
    description: 'Multiple-choice questions across STEM and humanities (MMLU).',
    scoring: 'mcq',
    miniCount: 5,
    fullCount: items.length,
    license: 'MIT',
    source: 'MMLU (Hendrycks et al., 2020)',
    items,
  });
}

async function buildArc() {
  if (!shouldBuild('arc')) return;
  console.log('Building ARC Challenge full…');
  const files = await listParquetFiles('allenai/ai2_arc');
  const testFile = files.find((f) => f.config === 'ARC-Challenge' && f.split === 'test');
  if (!testFile) throw new Error('ARC-Challenge test parquet not found');
  const rows = await readParquetUrl(testFile.url);
  const items = rows.map((row, i) => {
    const choices = row.choices?.text ?? [];
    return {
      id: `arc-${i + 1}`,
      prompt: formatMcqPrompt(row.question, choices),
      choices,
      groundTruth: String(row.answerKey ?? '').toUpperCase(),
      category: 'reasoning',
      metadata: { source: 'ARC', tier: 'full' },
    };
  });
  writePack('arc-challenge-mini.json', {
    id: 'arc-challenge-mini',
    label: 'ARC Challenge',
    category: 'reasoning',
    description: 'Grade-school science questions requiring reasoning (ARC Challenge).',
    scoring: 'mcq',
    miniCount: 4,
    fullCount: items.length,
    license: 'CC BY-SA',
    source: 'AI2 Reasoning Challenge (Clark et al., 2018)',
    items,
  });
}

async function buildGsm8k() {
  if (!shouldBuild('gsm8k')) return;
  console.log('Building GSM8K full…');
  const files = await listParquetFiles('openai/gsm8k');
  const wanted = files.filter((f) => f.config === 'main' && (f.split === 'train' || f.split === 'test'));
  const rows = [];
  for (const file of wanted) {
    await sleep(REQUEST_DELAY_MS);
    const batch = await readParquetUrl(file.url);
    rows.push(...batch);
    console.log(`  ${file.split}: ${batch.length}`);
  }
  const items = rows
    .map((row, i) => {
      const groundTruth = extractGsmAnswer(String(row.answer ?? ''));
      if (!groundTruth) return null;
      return {
        id: `gsm-${i + 1}`,
        prompt: `${row.question} Reply with the final number only.`,
        groundTruth,
        category: 'math',
        metadata: { source: 'GSM8K', tier: 'full' },
      };
    })
    .filter(Boolean);
  writePack('gsm8k-mini.json', {
    id: 'gsm8k-mini',
    label: 'GSM8K',
    category: 'math',
    description: 'Grade-school math word problems (GSM8K).',
    scoring: 'numeric',
    miniCount: 4,
    fullCount: items.length,
    license: 'MIT',
    source: 'GSM8K (Cobbe et al., 2021)',
    items,
  });
}

async function buildHumaneval() {
  if (!shouldBuild('humaneval')) return;
  console.log('Building HumanEval full…');
  const files = await listParquetFiles('openai/openai_humaneval');
  const testFile = files.find((f) => f.split === 'test');
  if (!testFile) throw new Error('HumanEval test parquet not found');
  const rows = await readParquetUrl(testFile.url);
  const items = rows.map((row, i) => ({
    id: row.task_id ?? `he-${i + 1}`,
    prompt: `${row.prompt}\nComplete the Python function. Reply with a fenced \`\`\`python code block only.`,
    groundTruth: String(row.canonical_solution ?? '').trim(),
    category: 'coding',
    metadata: {
      source: 'HumanEval',
      tier: 'full',
      tests: row.test,
      entryPoint: row.entry_point,
    },
  }));
  writePack('humaneval-mini.json', {
    id: 'humaneval-mini',
    label: 'HumanEval',
    category: 'coding',
    description: 'Python function synthesis with unit tests (HumanEval).',
    scoring: 'code',
    miniCount: 3,
    fullCount: items.length,
    license: 'MIT',
    source: 'HumanEval (Chen et al., 2021)',
    items,
  });

  const miniSlice = items.slice(0, 5).map((item) => ({
    ...item,
    metadata: { ...item.metadata, tier: 'mini' },
  }));
  writePack(
    'humaneval-mini.json',
    {
      id: 'humaneval-mini',
      label: 'HumanEval Mini',
      category: 'coding',
      description: 'Short Python function synthesis with unit tests (HumanEval-style).',
      scoring: 'code',
      miniCount: miniSlice.length,
      fullCount: items.length,
      license: 'MIT',
      source: 'HumanEval (Chen et al., 2021)',
      items: miniSlice,
    },
    MINI_DIR,
  );
}

async function buildTruthfulqa() {
  if (!shouldBuild('truthfulqa')) return;
  console.log('Building TruthfulQA full…');
  const files = await listParquetFiles('truthfulqa/truthful_qa');
  const mcFile = files.find((f) => f.config === 'multiple_choice' && f.split === 'validation');
  if (!mcFile) throw new Error('TruthfulQA MC parquet not found');
  const rows = await readParquetUrl(mcFile.url);
  const items = rows
    .map((row, i) => {
      const mc = row.mc1_targets;
      const choices = mc?.choices ?? [];
      const labels = mc?.labels ?? [];
      if (!choices.length) return null;
      const correctIdx = labels.findIndex((l) => l === 1);
      if (correctIdx < 0) return null;
      return {
        id: `tq-${i + 1}`,
        prompt: formatMcqPrompt(row.question, choices),
        choices,
        groundTruth: letterFromIndex(correctIdx),
        category: 'safety',
        metadata: { source: 'TruthfulQA', tier: 'full' },
      };
    })
    .filter(Boolean);
  writePack('truthfulqa-mini.json', {
    id: 'truthfulqa-mini',
    label: 'TruthfulQA',
    category: 'safety',
    description: 'Multiple-choice questions targeting common misconceptions (TruthfulQA MC1).',
    scoring: 'mcq',
    miniCount: 4,
    fullCount: items.length,
    license: 'Apache-2.0',
    source: 'TruthfulQA (Lin et al., 2021)',
    items,
  });
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`Writing packs to ${OUT_DIR}\n`);

await buildHumaneval();
await buildArc();
await buildTruthfulqa();
await buildGsm8k();
await buildMmlu();

console.log('\nDone.');
