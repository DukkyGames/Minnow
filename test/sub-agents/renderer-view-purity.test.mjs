/**
 * P8-G grep gate: no run-state mutation under src/agents/ outside the SSE store.
 *
 * The renderer is a view. Spawn/cancel POST; the store (`orchestrator.ts` +
 * `sub-agent-client.ts`) is the only place that may write the in-memory map,
 * and it only writes derived fold/SSE overlays. The controller directory and
 * client runner adapter are gone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'src', 'agents');

/** The SSE store — the only allowed writer of live SubAgentRun maps. */
const STORE_FILES = new Set(['orchestrator.ts', 'sub-agent-client.ts']);

const MUTATION_PATTERNS = [
  { re: /\bruns\.set\s*\(/, why: 'writes the live run map' },
  { re: /\brun\.status\s*=(?!=)/, why: 'assigns run.status' },
  { re: /\.lifecycle\s*=(?!=)/, why: 'assigns watchdog lifecycle' },
  { re: /\.livePhase\s*=(?!=)/, why: 'assigns livePhase (must overlay from SSE in the store)' },
];

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (!name.endsWith('.ts')) continue;
    if (name.endsWith('.d.ts')) continue;
    acc.push(full);
  }
  return acc;
}

describe('src/agents run-state mutation (P8-G)', () => {
  it('controller/ and sub-agent-runner.ts are gone', () => {
    assert.equal(fs.existsSync(path.join(AGENTS_DIR, 'controller')), false);
    assert.equal(fs.existsSync(path.join(AGENTS_DIR, 'sub-agent-runner.ts')), false);
  });

  it('only the SSE store writes run maps', () => {
    const files = walk(AGENTS_DIR);
    /** @type {string[]} */
    const hits = [];
    for (const file of files) {
      const rel = path.relative(AGENTS_DIR, file).replaceAll('\\', '/');
      const base = path.basename(file);
      if (STORE_FILES.has(base)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const { re, why } of MUTATION_PATTERNS) {
        if (re.test(src)) hits.push(`${rel}: ${why}`);
      }
    }
    assert.deepEqual(hits, [], hits.join('\n'));
  });

  it('production src/ does not import controller spawn/cancel', () => {
    const srcRoot = path.join(PROJECT_ROOT, 'src');
    const banned = /from ['"][^'"]*agents\/controller\//;
    /** @type {string[]} */
    const hits = [];
    function scan(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scan(full);
          continue;
        }
        if (!name.endsWith('.ts')) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (banned.test(src)) hits.push(path.relative(srcRoot, full).replaceAll('\\', '/'));
      }
    }
    scan(srcRoot);
    assert.deepEqual(hits, [], hits.join('\n'));
  });
});
