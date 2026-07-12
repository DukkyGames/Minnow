#!/usr/bin/env node
/**
 * MIN-387: Inventory `id=` hooks in index.html and grep src/ for DOM references.
 *
 * Usage:
 *   node scripts/index-html-coupling-map.mjs
 *   node scripts/index-html-coupling-map.mjs --json
 *   node scripts/index-html-coupling-map.mjs --dead-only
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SRC_DIR = path.join(ROOT, 'src');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const deadOnly = args.includes('--dead-only');

/** Collect every `id="…"` value from index.html (order preserved, deduped). */
function extractIndexIds(html) {
  const ids = [];
  const seen = new Set();
  const re = /\bid="([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Count inline `on*=…` handlers still present in index.html. */
function countInlineHandlers(html) {
  const re = /\bon[a-z]+="[^"]*"/gi;
  return (html.match(re) ?? []).length;
}

/** Walk src/ and return concatenated source text keyed by relative path. */
function readSrcFiles(dir = SRC_DIR, base = SRC_DIR) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...readSrcFiles(full, base));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|mts|css|html|md)$/.test(entry)) continue;
    const rel = path.relative(base, full).replace(/\\/g, '/');
    files.push({ rel, text: readFileSync(full, 'utf8') });
  }
  return files;
}

/** Return src files whose text references the given element id. */
function findIdReferences(id, srcFiles) {
  const patterns = [
    new RegExp(`getElementById\\(['"]${escapeRegExp(id)}['"]\\)`),
    new RegExp(`querySelector\\(['"]#${escapeRegExp(id)}['"]\\)`),
    new RegExp(`querySelectorAll\\(['"]#${escapeRegExp(id)}['"]\\)`),
    new RegExp(`['"]#${escapeRegExp(id)}['"]`),
    new RegExp(`id="${escapeRegExp(id)}"`),
    new RegExp(`id='${escapeRegExp(id)}'`),
  ];
  const hits = [];
  for (const file of srcFiles) {
    if (patterns.some((re) => re.test(file.text))) {
      hits.push(file.rel);
    }
  }
  return hits;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const ids = extractIndexIds(html);
  const inlineHandlers = countInlineHandlers(html);
  const srcFiles = readSrcFiles();
  const bytes = Buffer.byteLength(html, 'utf8');

  const entries = ids.map((id) => {
    const refs = findIdReferences(id, srcFiles);
    return { id, refs, referenced: refs.length > 0 };
  });

  const referenced = entries.filter((e) => e.referenced);
  const dead = entries.filter((e) => !e.referenced);

  const summary = {
    indexHtmlBytes: bytes,
    indexHtmlLines: html.split('\n').length,
    idCount: ids.length,
    inlineHandlerCount: inlineHandlers,
    referencedIdCount: referenced.length,
    deadIdCount: dead.length,
    srcFileCount: srcFiles.length,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, dead: dead.map((e) => e.id), entries }, null, 2));
    return;
  }

  if (deadOnly) {
    for (const entry of dead) {
      console.log(entry.id);
    }
    return;
  }

  console.log('index.html coupling map (MIN-387)');
  console.log('─'.repeat(48));
  console.log(`Size:              ${(bytes / 1024).toFixed(1)} KB (${summary.indexHtmlLines} lines)`);
  console.log(`Element ids:       ${summary.idCount}`);
  console.log(`Inline on* attrs:  ${summary.inlineHandlerCount}`);
  console.log(`Referenced in src: ${summary.referencedIdCount}`);
  console.log(`Possibly dead:     ${summary.deadIdCount}`);
  console.log('');

  if (dead.length > 0) {
    console.log('Possibly unreferenced ids (no match in src/):');
    for (const entry of dead) {
      console.log(`  - ${entry.id}`);
    }
    console.log('');
  }

  console.log('Tip: node scripts/index-html-coupling-map.mjs --json > coupling-map.json');
}

main();
