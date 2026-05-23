/**
 * run_impeccable harness vs CLI routing.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { toolRunImpeccable } from '../../server/impeccable/run-impeccable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('toolRunImpeccable', () => {
  it('returns harness guidance for teach without spawning CLI', async () => {
    const out = await toolRunImpeccable(
      { command: 'teach' },
      PROJECT_ROOT,
      PROJECT_ROOT,
    );
    const text = String(out.result ?? '');
    assert.match(text, /harness command/i);
    assert.match(text, /reference\/teach\.md/);
    assert.doesNotMatch(text, /failed to spawn npx impeccable/i);
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
});
