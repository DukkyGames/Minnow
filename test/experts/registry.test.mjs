import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { beforeEach, describe, test } from 'node:test';
import {
  listExperts,
  registerExpertFilesFromRaw,
  resetExpertRegistry,
} from '../../src/chat/experts/registry.ts';
import { loadExpertFixtureMap } from './test-helpers.mjs';

describe('expert registry', () => {
  beforeEach(() => {
    resetExpertRegistry();
  });

  test('listExperts merges builtin and user override label', () => {
    registerExpertFilesFromRaw(
      {
        './experts/software-engineer/expert.full.md': `---
id: software-engineer
kind: expert
label: Builtin engineer
version: 1
---
[[EXPERT:software-engineer]]
Body`,
      },
      'builtin',
    );
    registerExpertFilesFromRaw(
      {
        './experts/software-engineer/expert.full.md': `---
id: software-engineer
kind: expert
label: User engineer
version: 1
---
[[EXPERT:software-engineer]]
Override`,
      },
      'user',
    );

    const experts = listExperts();
    const se = experts.find((e) => e.meta.id === 'software-engineer');
    assert.ok(se);
    assert.equal(se.meta.label, 'User engineer');
    assert.equal(se.source, 'user');
  });

  test('invalid meta skipped', async () => {
    const map = await loadExpertFixtureMap();
    registerExpertFilesFromRaw(map, 'builtin');
    const ids = listExperts().map((e) => e.meta.id);
    assert.ok(!ids.includes('not-an-expert'));
  });

  test('stable sort by label', async () => {
    const map = await loadExpertFixtureMap();
    registerExpertFilesFromRaw(map, 'builtin');
    const labels = listExperts().map((e) => e.meta.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(labels, sorted);
  });
});
