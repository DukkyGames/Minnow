import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import { mergeConfigMeta } from '../../server/config/validators.js';

describe('terminal autoOpenOnAgentRun defaults', () => {
  test('DEFAULT_META seeds autoOpenOnAgentRun false for new homes', () => {
    assert.equal(DEFAULT_META.terminal?.autoOpenOnAgentRun, false);
  });

  test('mergeConfigMeta defaults terminal.autoOpenOnAgentRun to false', () => {
    const merged = mergeConfigMeta({}, { terminal: {} });
    assert.equal(merged.terminal.autoOpenOnAgentRun, false);
  });

  test('mergeConfigMeta preserves explicit true', () => {
    const merged = mergeConfigMeta(
      { terminal: { autoOpenOnAgentRun: false } },
      { terminal: { autoOpenOnAgentRun: true } },
    );
    assert.equal(merged.terminal.autoOpenOnAgentRun, true);
  });
});
