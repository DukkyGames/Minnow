/**
 * engine-bundle build and load smoke tests (MIN-354 Stage 3).
 *
 * Models on test/engine/engine-tsx-hooks.test.mjs spawnSync harness.
 * Runs as plain `node` (no tsx hooks) to prove the bundle is self-contained.
 *
 * Assertions:
 *  1. Build succeeds and emits > 1 MB file
 *  2. Bundle loads under plain `node` with no --import flags
 *  3. Mode selection: env override + missing-bundle → unavailable
 *  4. tsx-namespace shape matches the known bundle-entry export list
 *  5. Bundle output references correct server extern specifiers (e.g. ../engine-api.js)
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_BUNDLE = path.join(
  REPO_ROOT,
  'server',
  'session',
  'engine-bundle',
  'engine-bundle.mjs',
);

/** Named exports that must exist on the bundle namespace. */
const EXPECTED_EXPORTS = [
  'runEngineMainChatTurn',
  'resumeEngineBoardsOnBoot',
  'rebindEngineBoardHostSession',
  'activateEngineBoardHost',
  'deactivateEngineBoardHost',
  'isEngineBoardHostActive',
  'applyBoardCommand',
  'bootEngineControllerOnStart',
  'activateEngineControllerHost',
  'applyControllerSessionCommand',
  'parkAskQuestion',
  'cancelParkedAskQuestion',
  'resolveParkedAskQuestion',
  'buildEngineApiMessages',
  'buildEngineHistoryUserContent',
  'setSessionStateForEngineHost',
];

/**
 * Spawn a plain Node process to run inline ESM code.
 * Forces process.exit(0) at the end so any pending handles don't cause hangs.
 * @param {string} code
 * @param {Record<string, string>} [extraEnv]
 */
function runInlineMjs(code, extraEnv = {}) {
  // Always append process.exit(0) so bundle-level module init timers can't hang the child.
  const withExit = `${code}\nprocess.exit(0);`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', withExit], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 30000,
  });
}

describe('engine-bundle', () => {
  // Build the bundle once before all tests in this file.
  before(async () => {
    const { buildEngineBundle } = await import('../../scripts/build-engine-bundle.mjs');
    await buildEngineBundle();
  });

  test('bundle file exists and is > 1 MB', () => {
    assert.ok(fs.existsSync(ENGINE_BUNDLE), `bundle not found at ${ENGINE_BUNDLE}`);
    const stat = fs.statSync(ENGINE_BUNDLE);
    assert.ok(
      stat.size > 1024 * 1024,
      `expected bundle > 1 MB, got ${(stat.size / 1024 / 1024).toFixed(2)} MB`,
    );
  });

  test('loads under plain node with no --import; exports are functions', () => {
    const code = `
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(${JSON.stringify(ENGINE_BUNDLE)}).href);
if (typeof window !== 'undefined') throw new Error('window must be undefined in Node');
const fns = ${JSON.stringify(EXPECTED_EXPORTS)};
for (const fn of fns) {
  if (typeof mod[fn] !== 'function') throw new Error('expected function export: ' + fn + ', got ' + typeof mod[fn]);
}
console.log('bundle-load-ok');
`.trim();

    const result = runInlineMjs(code);
    assert.equal(
      result.status,
      0,
      `bundle load failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stdout, /bundle-load-ok/);
  });

  test('mode selection: MINNOW_ENGINE_MODULE=bundle uses bundle', () => {
    const code = `
import { describeEngineAvailability } from './server/session/engine-module.js';
const avail = describeEngineAvailability();
if (!avail.available) throw new Error('expected available, got: ' + JSON.stringify(avail));
if (avail.mode !== 'bundle') throw new Error('expected bundle mode, got: ' + avail.mode);
console.log('mode-bundle-ok');
`.trim();

    const result = runInlineMjs(code, { MINNOW_ENGINE_MODULE: 'bundle' });
    assert.equal(
      result.status,
      0,
      `mode=bundle test failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stdout, /mode-bundle-ok/);
  });

  test('mode selection: MINNOW_ENGINE_MODULE=tsx treats mode as tsx', () => {
    const code = `
import { describeEngineAvailability } from './server/session/engine-module.js';
const avail = describeEngineAvailability();
if (!avail.available) throw new Error('expected available for tsx override, got: ' + JSON.stringify(avail));
if (avail.mode !== 'tsx') throw new Error('expected tsx mode, got: ' + avail.mode);
console.log('mode-tsx-ok');
`.trim();

    const result = runInlineMjs(code, { MINNOW_ENGINE_MODULE: 'tsx' });
    assert.equal(
      result.status,
      0,
      `mode=tsx test failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stdout, /mode-tsx-ok/);
  });

  test('unavailable when MINNOW_ENGINE_MODULE is invalid; loadEngineModule rejects with ENGINE_UNAVAILABLE', () => {
    const code = `
import { describeEngineAvailability, EngineUnavailableError, loadEngineModule } from './server/session/engine-module.js';
const avail = describeEngineAvailability();
if (avail.available) throw new Error('expected unavailable but got: ' + JSON.stringify(avail));
if (avail.mode !== 'unavailable') throw new Error('expected unavailable mode, got: ' + avail.mode);

let threw = false;
try {
  await loadEngineModule();
} catch (err) {
  threw = true;
  if (!(err instanceof EngineUnavailableError)) throw new Error('expected EngineUnavailableError, got: ' + err.constructor.name);
  if (err.code !== 'ENGINE_UNAVAILABLE') throw new Error('expected ENGINE_UNAVAILABLE code, got: ' + err.code);
}
if (!threw) throw new Error('loadEngineModule should have thrown');
console.log('unavailable-ok');
`.trim();

    const result = runInlineMjs(code, { MINNOW_ENGINE_MODULE: 'bogus' });
    assert.equal(
      result.status,
      0,
      `unavailable test failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stdout, /unavailable-ok/);
  });

  test('bundle output uses correct relative server extern specifiers', () => {
    assert.ok(fs.existsSync(ENGINE_BUNDLE), 'bundle must exist for extern check');
    const text = fs.readFileSync(ENGINE_BUNDLE, 'utf8');

    // Server modules stay external and are resolved from the outdir (engine-bundle/).
    assert.match(
      text,
      /import\s*\(\s*['"]\.\.\/engine-api\.js['"]\s*\)/,
      'expected ../engine-api.js-style extern in bundle',
    );

    // Must NOT contain wrong ../server/ path depth errors.
    assert.doesNotMatch(
      text,
      /from\s+['"](?:\.\.\/)+server\//,
      'bundle must not contain ../server/ style paths',
    );
  });

  test('tsx-namespace exports match bundle-entry export list', async () => {
    const { resetEngineModuleForTests } = await import(
      '../../server/session/engine-module.js'
    );
    // Reset so that MINNOW_TEST=1 (set by test-loader) triggers tsx mode.
    resetEngineModuleForTests();

    const { describeEngineAvailability, loadEngineModule } = await import(
      '../../server/session/engine-module.js'
    );
    const avail = describeEngineAvailability();
    assert.equal(avail.mode, 'tsx', `expected tsx mode under test-loader, got ${avail.mode}`);

    const mod = await loadEngineModule();
    for (const name of EXPECTED_EXPORTS) {
      assert.ok(
        typeof mod[name] === 'function',
        `tsx namespace missing export: ${name} (got ${typeof mod[name]})`,
      );
    }

    resetEngineModuleForTests();
  });
});
