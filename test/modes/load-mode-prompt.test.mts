/**
 * Mode prompt loader integration tests.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  loadModePromptBody,
  MODE_IDS,
} from '../../src/chat/modes/registry.ts';
import {
  clearUserPromptRegistry,
  registerPromptFilesFromRaw,
  resetPromptRegistry,
  setUserPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import { loadBuiltinModePromptMap } from './test-helpers.mts';

describe('loadModePromptBody', () => {
  beforeEach(() => {
    resetPromptRegistry();
    clearUserPromptRegistry();
  });

  test('each mode loads non-empty full and lite bodies', async () => {
    registerPromptFilesFromRaw(await loadBuiltinModePromptMap());
    for (const id of MODE_IDS) {
      const full = loadModePromptBody(id, 'full');
      const lite = loadModePromptBody(id, 'lite');
      assert.ok(full.length > 0, `${id} full empty`);
      assert.ok(lite.length > 0, `${id} lite empty`);
      assert.match(full, new RegExp(`MINNOW_MODE_MARKER: ${id} full`));
      assert.match(lite, new RegExp(`MINNOW_MODE_MARKER: ${id} lite`));
    }
  });

  test('plan full contains do-not-modify guidance', async () => {
    registerPromptFilesFromRaw(await loadBuiltinModePromptMap());
    const body = loadModePromptBody('plan', 'full');
    assert.match(body.toLowerCase(), /do not modify/);
  });

  test('build lite shorter than build full', async () => {
    registerPromptFilesFromRaw(await loadBuiltinModePromptMap());
    const full = loadModePromptBody('build', 'full');
    const lite = loadModePromptBody('build', 'lite');
    assert.ok(lite.length < full.length);
    assert.match(lite, /LITE/);
  });

  test('user override wins over built-in', async () => {
    registerPromptFilesFromRaw(await loadBuiltinModePromptMap());
    setUserPromptRegistry([
      {
        id: 'build',
        kind: 'mode',
        part: 'mode',
        label: 'Build override',
        version: 1,
        body: 'OVERRIDE_MARKER full body',
        relativePath: 'modes/build.full.md',
        source: 'user',
      },
    ]);
    const body = loadModePromptBody('build', 'full');
    assert.match(body, /OVERRIDE_MARKER/);
  });
});
