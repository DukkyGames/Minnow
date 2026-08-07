/**
 * run_impeccable harness vs CLI routing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { listAcceptedRunImpeccableCommands } from '../../server/impeccable/command-routing.js';
import {
  resolveBundledImpeccableCliPath,
  toolRunImpeccable,
} from '../../server/impeccable/run-impeccable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('toolRunImpeccable', () => {
  it('resolveBundledImpeccableCliPath uses appRoot node_modules', () => {
    const cliPath = resolveBundledImpeccableCliPath(PROJECT_ROOT);
    assert.match(cliPath, /node_modules[\\/]impeccable[\\/]cli[\\/]bin[\\/]cli\.js$/);
    assert.ok(fs.existsSync(cliPath), 'bundled impeccable CLI should exist in dev install');
  });

  it('accepts only detect and live for spawnable commands', () => {
    assert.deepEqual(listAcceptedRunImpeccableCommands(), ['detect', 'live']);
  });

  it('returns harness guidance for teach (init alias) without spawning CLI', async () => {
    const out = await toolRunImpeccable(
      { command: 'teach' },
      PROJECT_ROOT,
      PROJECT_ROOT,
    );
    const text = String(out.result ?? '');
    assert.match(text, /harness command/i);
    assert.match(text, /reference\/init\.md/);
    assert.match(text, /# Init Flow|Init Flow|init/i);
    assert.doesNotMatch(text, /failed to spawn npx impeccable/i);
  });

  it('returns shape reference body when shape is passed mistakenly', async () => {
    const out = await toolRunImpeccable(
      { command: 'shape', target: 'landing page' },
      PROJECT_ROOT,
      PROJECT_ROOT,
    );
    const text = String(out.result ?? '');
    assert.match(text, /harness command/i);
    assert.match(text, /reference\/shape\.md/);
    assert.match(text, /Discovery Interview|design brief/i);
  });

  it('returns harness guidance for audit', async () => {
    const out = await toolRunImpeccable(
      { command: 'audit' },
      PROJECT_ROOT,
      PROJECT_ROOT,
    );
    assert.match(String(out.result ?? ''), /harness command/i);
  });

  it('accepts detect and does not return harness-only guidance', async () => {
    const out = await toolRunImpeccable(
      { command: 'detect', target: 'index.html' },
      PROJECT_ROOT,
      PROJECT_ROOT,
    );
    const text = String(out.result ?? '');
    assert.doesNotMatch(text, /is a harness command/i);
  });

  it('detect without target defaults to cwd and does not hang on stdin', async () => {
    const tinyRoot = await mkdtemp(path.join(os.tmpdir(), 'minnow-impeccable-'));
    try {
      await fs.promises.writeFile(
        path.join(tinyRoot, 'index.html'),
        '<!doctype html><html><body><h1>Hi</h1></body></html>',
        'utf8',
      );
      const start = Date.now();
      const out = await toolRunImpeccable({ command: 'detect' }, PROJECT_ROOT, tinyRoot);
      const elapsed = Date.now() - start;
      const text = String(out.result ?? '');
      assert.ok(elapsed < 5000, `detect without target took ${elapsed}ms (expected <5000ms)`);
      assert.doesNotMatch(text, /timed out/i);
      assert.doesNotMatch(text, /is a harness command/i);
    } finally {
      await rm(tinyRoot, { recursive: true, force: true });
    }
  });
});
