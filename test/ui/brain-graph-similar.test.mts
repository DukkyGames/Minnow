/**
 * Brain page graph similarTo edges (MIN-139).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildPageGraph } from '../../src/ui/brain/graph/graph-data.ts';
import type { BrainPageMeta } from '../../src/brain/types.ts';

describe('buildPageGraph similarTo', () => {
  test('creates similar edges from frontmatter', () => {
    const pages: BrainPageMeta[] = [
      {
        id: 'a',
        title: 'A',
        path: 'workspaces/ws/archive/c1/turns-0000-0001.md',
        folder: 'workspaces/ws/archive/c1',
        slug: 'turns-0000-0001',
        tags: [],
        source: 'archive',
        summary: '',
        pinned: false,
        createdAt: '',
        updatedAt: '',
        links: [],
        similarTo: ['workspaces/ws/archive/c1/turns-0002-0003.md'],
      },
      {
        id: 'b',
        title: 'B',
        path: 'workspaces/ws/archive/c1/turns-0002-0003.md',
        folder: 'workspaces/ws/archive/c1',
        slug: 'turns-0002-0003',
        tags: [],
        source: 'archive',
        summary: '',
        pinned: false,
        createdAt: '',
        updatedAt: '',
        links: [],
      },
    ];
    const { edges } = buildPageGraph(pages, { includeTags: false });
    assert.ok(edges.some((e) => e.kind === 'similar'));
  });
});
