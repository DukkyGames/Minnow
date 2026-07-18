import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  fallbackGreeting,
  resolveAuthoredGreeting,
} from '../../../src/chat/experts/greet.ts';
import type { ExpertMeta } from '../../../src/chat/experts/types.ts';

describe('resolveAuthoredGreeting', () => {
  test('prefers authored greeting from frontmatter', () => {
    const meta: ExpertMeta = {
      id: 'software-engineer',
      kind: 'expert',
      label: 'Software engineer',
      greeting: 'Hey — engineer on deck.',
    };
    assert.equal(resolveAuthoredGreeting(meta), 'Hey — engineer on deck.');
  });

  test('falls back to deterministic label/description template', () => {
    const meta: ExpertMeta = {
      id: 'x',
      kind: 'expert',
      label: 'Patent counsel',
      description: 'Plain-English claim review.',
    };
    assert.equal(
      resolveAuthoredGreeting(meta),
      fallbackGreeting('Patent counsel', 'Plain-English claim review.'),
    );
  });
});
