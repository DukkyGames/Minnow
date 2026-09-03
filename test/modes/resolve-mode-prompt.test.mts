/**
 * Mode prompt path resolution tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveModePromptPath } from '../../src/chat/modes/registry.ts';

describe('resolveModePromptPath', () => {
  test('general full', () => {
    assert.ok(
      resolveModePromptPath('general', 'full').endsWith('modes/general.full.md'),
    );
  });

  test('general lite', () => {
    assert.ok(
      resolveModePromptPath('general', 'lite').endsWith('modes/general.lite.md'),
    );
  });

  test('email remaps to general prompt files', () => {
    assert.ok(resolveModePromptPath('email', 'full').endsWith('modes/general.full.md'));
    assert.ok(resolveModePromptPath('email', 'lite').endsWith('modes/general.lite.md'));
  });

  test('build full', () => {
    assert.ok(resolveModePromptPath('build', 'full').endsWith('modes/build.full.md'));
  });

  test('build lite', () => {
    assert.ok(resolveModePromptPath('build', 'lite').endsWith('modes/build.lite.md'));
  });

  test('plan full', () => {
    assert.ok(resolveModePromptPath('plan', 'full').endsWith('modes/plan.full.md'));
  });

  test('plan lite', () => {
    assert.ok(resolveModePromptPath('plan', 'lite').endsWith('modes/plan.lite.md'));
  });

  test('orchestrate full', () => {
    assert.ok(
      resolveModePromptPath('orchestrate', 'full').endsWith('modes/orchestrate.full.md'),
    );
  });

  test('orchestrate lite', () => {
    assert.ok(
      resolveModePromptPath('orchestrate', 'lite').endsWith('modes/orchestrate.lite.md'),
    );
  });

  test('debug full', () => {
    assert.ok(resolveModePromptPath('debug', 'full').endsWith('modes/debug.full.md'));
  });

  test('debug lite', () => {
    assert.ok(resolveModePromptPath('debug', 'lite').endsWith('modes/debug.lite.md'));
  });
});
