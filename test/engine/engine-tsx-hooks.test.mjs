/**
 * Boot smoke for Session Engine tsx hooks (MIN-354 / MIN-360).
 *
 * Live boot failed when engine-tsx-hooks.mjs exported resolve/load without
 * calling register() — --import alone does not activate customization hooks.
 * This suite spawns a child with the same --import preload as `npm start`
 * (no test-loader) and asserts register ran + .css resolves.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOKS_IMPORT = './server/session/engine-tsx-hooks.mjs';
const DUMMY_CSS = path.join(
  REPO_ROOT,
  'test/engine/fixtures/dummy-engine-hooks.css',
);
const DUMMY_CSS_URL = pathToFileURL(DUMMY_CSS).href;

/**
 * Run a small ESM snippet under Node with optional --import preloads.
 * @param {string[]} importSpecs
 * @param {string} source
 */
function runWithImports(importSpecs, source) {
  const args = [];
  for (const spec of importSpecs) {
    args.push('--import', spec);
  }
  args.push('--input-type=module', '-e', source);
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

describe('engine-tsx-hooks boot smoke', () => {
  test('self-registers on --import and resolves a dummy .css', () => {
    // Mirror package.json start: --import ./server/session/engine-tsx-hooks.mjs
    const source = `
import assert from 'node:assert/strict';
assert.equal(
  globalThis.__MINNOW_ENGINE_TSX_HOOKS_REGISTERED,
  true,
  'hooks must call register() on --import',
);
const mod = await import(${JSON.stringify(DUMMY_CSS_URL)});
assert.deepEqual(mod.default, {});
console.log('engine-tsx-hooks-ok');
`;
    const result = runWithImports([HOOKS_IMPORT], source);
    assert.equal(
      result.status,
      0,
      `hooks preload failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stdout, /engine-tsx-hooks-ok/);
  });

  test('without hooks, bare .css import fails (guards the assertion)', () => {
    // Control: same import must not succeed unless customization hooks are active.
    const source = `
await import(${JSON.stringify(DUMMY_CSS_URL)});
console.log('unexpected-css-ok');
`;
    const result = runWithImports([], source);
    assert.notEqual(
      result.status,
      0,
      'expected bare .css import to fail without engine-tsx-hooks',
    );
    assert.doesNotMatch(result.stdout, /unexpected-css-ok/);
  });
});
