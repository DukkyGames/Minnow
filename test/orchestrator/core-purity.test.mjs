/**
 * P0-A — purity guard for `server/orchestrator/core/`.
 *
 * The core is the decision surface of Orchestrator V2, and `state = fold(journal)`
 * only recovers a crashed board if replay reproduces the same decisions. That
 * makes purity load-bearing rather than stylistic, so it is enforced mechanically
 * here instead of in review.
 *
 * Runs on the plain `node` runner with no loader flags — which is itself part of
 * the assertion. If this file ever needs `tsx`, the core stopped being plain JS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_DIR = path.join(PROJECT_ROOT, 'server', 'orchestrator', 'core');

/** Textual bans. Each is a clock, a random source, or an I/O surface. */
const BANNED_PATTERNS = [
  { re: /\bDate\.now\s*\(/, why: 'reads the clock; take time as an argument instead' },
  { re: /\bnew\s+Date\s*\(\s*\)/, why: 'reads the clock; take time as an argument instead' },
  { re: /\bMath\.random\s*\(/, why: 'nondeterministic; replay would diverge' },
  { re: /\bprocess\./, why: 'host access; the core runs in the renderer too' },
  { re: /\bfs\./, why: 'filesystem I/O is not allowed in the core' },
  { re: /\bfetch\s*\(/, why: 'network I/O is not allowed in the core' },
  { re: /\brequire\s*\(/, why: 'the core is ESM-only' },
];

/**
 * Strip comments so a rule cited in prose does not fail the file that cites it.
 * Deliberately naive — it is only good enough for source we control, which is
 * the only source it is ever pointed at.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Collect every static import/export specifier in a module.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function importSpecifiers(source) {
  const code = stripComments(source);
  /** @type {string[]} */
  const found = [];
  const statement = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(statement)) found.push(match[1]);
  const bare = /\bimport\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(bare)) found.push(match[1]);
  const dynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of code.matchAll(dynamic)) found.push(match[1]);
  return found;
}

/**
 * Check one core module for purity violations.
 *
 * @param {string} relPath  path relative to `core/`, used only in messages
 * @param {string} source
 * @returns {string[]} one message per violation; empty means pure
 */
export function checkCoreModule(relPath, source) {
  /** @type {string[]} */
  const violations = [];
  const code = stripComments(source);

  for (const { re, why } of BANNED_PATTERNS) {
    if (re.test(code)) violations.push(`${relPath}: matches ${re} — ${why}`);
  }

  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      violations.push(`${relPath}: imports '${specifier}' — the core may only import within core/`);
      continue;
    }
    const resolved = path.resolve(path.dirname(path.join(CORE_DIR, relPath)), specifier);
    const inside = path.relative(CORE_DIR, resolved);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      violations.push(`${relPath}: imports '${specifier}' — resolves outside core/`);
    }
  }

  return violations;
}

/** @returns {string[]} every `.js` under core/, relative to core/ */
function coreModules() {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(path.relative(CORE_DIR, full).split(path.sep).join('/'));
    }
  };
  walk(CORE_DIR);
  return out.sort();
}

describe('orchestrator core purity guard', () => {
  it('finds core modules to check', () => {
    const modules = coreModules();
    assert.ok(modules.length > 0, 'no .js modules found under server/orchestrator/core');
    assert.ok(modules.includes('index.js'), 'core/index.js barrel is missing');
  });

  it('every core module is pure', () => {
    /** @type {string[]} */
    const violations = [];
    for (const relPath of coreModules()) {
      const source = fs.readFileSync(path.join(CORE_DIR, relPath), 'utf8');
      violations.push(...checkCoreModule(relPath, source));
    }
    assert.deepEqual(violations, []);
  });

  it('every core module has a .d.ts companion', () => {
    for (const relPath of coreModules()) {
      const companion = path.join(CORE_DIR, relPath.replace(/\.js$/, '.d.ts'));
      assert.ok(fs.existsSync(companion), `missing type companion for core/${relPath}`);
    }
  });

  it('the core directory contains no TypeScript sources', () => {
    const ts = fs
      .readdirSync(CORE_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
    assert.deepEqual(ts, [], 'the core ships untranspiled; author .js + .d.ts');
  });

  it('README states the three rules', () => {
    const readme = fs.readFileSync(path.join(CORE_DIR, 'README.md'), 'utf8');
    assert.match(readme, /No I\/O/);
    assert.match(readme, /No clock, no randomness/);
    assert.match(readme, /No imports outside this directory/);
  });
});

describe('the purity guard itself', () => {
  it('rejects a node: import', () => {
    const violations = checkCoreModule('derive.js', "import fs from 'node:fs';\nexport const a = 1;\n");
    assert.equal(violations.length, 1);
    assert.match(violations[0], /may only import within core\//);
  });

  it('rejects an import that escapes core/', () => {
    const violations = checkCoreModule('derive.js', "import { x } from '../../tools/output-cap.js';\n");
    assert.equal(violations.length, 1);
    assert.match(violations[0], /resolves outside core\//);
  });

  it('accepts a relative import within core/', () => {
    assert.deepEqual(checkCoreModule('derive.js', "import { validateEvent } from './events.js';\n"), []);
    assert.deepEqual(checkCoreModule('sub/a.js', "import { b } from '../events.js';\n"), []);
  });

  it('rejects clock, randomness, and I/O', () => {
    assert.match(checkCoreModule('a.js', 'const t = Date.now();')[0], /reads the clock/);
    assert.match(checkCoreModule('a.js', 'const t = new Date();')[0], /reads the clock/);
    assert.match(checkCoreModule('a.js', 'const r = Math.random();')[0], /nondeterministic/);
    assert.match(checkCoreModule('a.js', 'const p = process.env.X;')[0], /host access/);
    assert.match(checkCoreModule('a.js', 'fs.readFileSync(p);')[0], /filesystem I\/O/);
    assert.match(checkCoreModule('a.js', 'await fetch(url);')[0], /network I\/O/);
  });

  it('does not fire on words that merely contain a banned token', () => {
    assert.deepEqual(checkCoreModule('a.js', 'const refs = []; const defs = refs.map((r) => r);'), []);
    assert.deepEqual(checkCoreModule('a.js', 'const updated = state.processed;'), []);
  });

  it('ignores banned tokens inside comments', () => {
    const source = '// never call Date.now() here\n/* nor process.env */\nexport const a = 1;\n';
    assert.deepEqual(checkCoreModule('a.js', source), []);
  });

  it('sees imports the same way regardless of statement shape', () => {
    const source = [
      "import a from './a.js';",
      "import { b } from './b.js';",
      "export { c } from './c.js';",
      "import './d.js';",
      "const e = await import('./e.js');",
    ].join('\n');
    assert.deepEqual(importSpecifiers(source), ['./a.js', './b.js', './c.js', './d.js', './e.js']);
  });
});
