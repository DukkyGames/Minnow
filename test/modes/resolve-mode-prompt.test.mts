/**
 * Mode prompt path resolution tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveModePromptPath } from '../../src/chat/modes/registry.ts';

describe('resolveModePromptPath', () => {
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

  test('research full', () => {
    assert.ok(
      resolveModePromptPath('research', 'full').endsWith('modes/research.full.md'),
    );
  });

  test('research lite', () => {
    assert.ok(
      resolveModePromptPath('research', 'lite').endsWith('modes/research.lite.md'),
    );
  });
});
