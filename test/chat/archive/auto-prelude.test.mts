/**
 * Archive auto-prelude formatting (MIN-139).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildArchivePreludeBlock,
  dedupeArchiveHits,
} from '../../../src/chat/archive/auto-prelude.ts';

describe('buildArchivePreludeBlock', () => {
  test('empty hits yields no content', () => {
    const out = buildArchivePreludeBlock([], 5);
    assert.equal(out.content, '');
    assert.equal(out.recalled, 0);
  });

  test('formats entity hit with quote', () => {
    const out = buildArchivePreludeBlock(
      [
        {
          path: 'workspaces/ws/archive/chat1/turns-0000-0003.md',
          title: 'Auth decision',
          excerpt: 'We use JWT.',
          sourceQuote: 'We chose JWT for sessions.',
        },
      ],
      5,
    );
    assert.ok(out.content.includes('<retrieved_context source="archive">'));
    assert.ok(out.content.includes('We chose JWT for sessions.'));
    assert.equal(out.recalled, 1);
  });

  test('dedupes and caps topK', () => {
    const hits = dedupeArchiveHits([
      { path: 'a.md', title: 'A', excerpt: '1' },
      { path: 'a.md', title: 'A', excerpt: '2' },
      { path: 'b.md', title: 'B', excerpt: '3' },
    ]);
    assert.equal(hits.length, 2);
    const out = buildArchivePreludeBlock(hits, 1);
    assert.equal(out.recalled, 1);
  });
});
