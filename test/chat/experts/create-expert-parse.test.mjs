import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildExpertMarkdown, parseExpertFiles } from '../../../src/chat/experts/expert-markdown.ts';

describe('create-expert parse helpers', () => {
  test('buildExpertMarkdown round-trip', () => {
    const full = buildExpertMarkdown(
      {
        id: 'test-coach',
        label: 'Test Coach',
        description: 'Helps with tests',
        icon: '🧪',
        accent: 'cyan',
      },
      'You are a testing coach.',
      'full',
    );

    const lite = buildExpertMarkdown(
      {
        id: 'test-coach',
        label: 'Test Coach',
        description: 'Helps with tests',
        icon: '🧪',
        accent: 'cyan',
      },
      'Short coach persona.',
      'lite',
    );

    const parsed = parseExpertFiles(full, lite);
    assert.ok(parsed);
    assert.equal(parsed.meta.id, 'test-coach');
    assert.equal(parsed.meta.label, 'Test Coach');
    assert.match(parsed.fullBody, /testing coach/);
    assert.match(parsed.liteBody, /Short coach/);
  });
});
