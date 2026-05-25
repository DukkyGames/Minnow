/**
 * Capability badge formatting for model picker.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatCapabilityBadges,
  formatContextBadge,
} from '../../src/providers/capability-badges.ts';

describe('formatContextBadge', () => {
  test('formats thousands as k', () => {
    assert.equal(formatContextBadge(32768), '32.8k');
    assert.equal(formatContextBadge(8000), '8k');
  });
});

describe('formatCapabilityBadges', () => {
  test('returns Tools Vision and context', () => {
    const badges = formatCapabilityBadges({
      vision: true,
      tools: true,
      streaming: true,
      grammar: null,
      reasoning: null,
      contextLength: 32768,
      loadState: 'loaded',
    });
    assert.deepEqual(badges, ['Tools', 'Vision', '32.8k']);
  });

  test('returns empty when caps undefined', () => {
    assert.deepEqual(formatCapabilityBadges(undefined), []);
  });
});
