/**
 * Deep Research library — newest/oldest sort uses ISO timestamps on disk.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { getResearchDataDir, listResearchLibrary } from '../../server/research/store.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

/** @type {string} */
let testHome;

function researchFixture(id, query, completedAt) {
  return {
    id,
    query,
    status: 'done',
    result: '# Report',
    sources: [],
    raw_findings: [],
    stats: {},
    category: 'general',
    started_at: completedAt,
    completed_at: completedAt,
    archived: false,
  };
}

async function writeResearchFixture(id, query, completedAt) {
  const dir = getResearchDataDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify(researchFixture(id, query, completedAt), null, 2),
    'utf8',
  );
}

before(() => {
  testHome = setTestHome(process.env, 'minnow-research-library-sort');
});

after(async () => {
  await rmTestHome(testHome);
});

describe('research library sort', () => {
  it('sorts newest first when sort=recent (ISO completed_at)', async () => {
    await writeResearchFixture('rs-111111111111', 'Oldest topic', '2026-01-01T10:00:00.000Z');
    await writeResearchFixture('rs-222222222222', 'Middle topic', '2026-02-01T10:00:00.000Z');
    await writeResearchFixture('rs-333333333333', 'Newest topic', '2026-03-01T10:00:00.000Z');

    const { research } = await listResearchLibrary({ sort: 'recent', limit: 10 });
    assert.deepEqual(
      research.map((row) => row.id),
      ['rs-333333333333', 'rs-222222222222', 'rs-111111111111'],
    );
  });

  it('sorts oldest first when sort=oldest (ISO completed_at)', async () => {
    const { research } = await listResearchLibrary({ sort: 'oldest', limit: 10 });
    assert.deepEqual(
      research.map((row) => row.id),
      ['rs-111111111111', 'rs-222222222222', 'rs-333333333333'],
    );
  });
});
