import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import { mergeConfigMeta } from '../../server/config/validators.js';

describe('config.json chat.maxToolTurns merge', () => {
  test('DEFAULT_META seeds chat.maxToolTurns for new homes', () => {
    assert.equal(DEFAULT_META.chat?.maxToolTurns, 8);
  });

  test('mergeConfigMeta defaults chat block when patch provides empty object', () => {
    const merged = mergeConfigMeta({}, { chat: {} });
    assert.equal(merged.chat.maxToolTurns, 8);
  });

  test('mergeConfigMeta clamps chat.maxToolTurns to 64', () => {
    const merged = mergeConfigMeta({}, { chat: { maxToolTurns: 200 } });
    assert.equal(merged.chat.maxToolTurns, 64);
  });

  test('mergeConfigMeta clamps chat.maxToolTurns to at least 1', () => {
    const merged = mergeConfigMeta({}, { chat: { maxToolTurns: 0 } });
    assert.equal(merged.chat.maxToolTurns, 1);
  });

  test('mergeConfigMeta preserves valid value', () => {
    const merged = mergeConfigMeta(
      { chat: { maxToolTurns: 8 } },
      { chat: { maxToolTurns: 24 } },
    );
    assert.equal(merged.chat.maxToolTurns, 24);
  });
});
