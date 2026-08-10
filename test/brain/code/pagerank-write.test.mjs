/**
 * PageRank persistence.
 *
 * Regression cover for `writePageRanks` being handed the Map returned by
 * `personalizedPageRank` while doing `Object.entries(...)` on it — always `[]`, so every
 * symbol kept pagerank 0 and repo-map ordering ran on a flat graph.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../../server/config/home.js';
import {
  buildAdjacency,
  buildPersonalizationVector,
  personalizedPageRank,
} from '../../../server/brain/code/rank.js';
import { recomputePageRank } from '../../../server/brain/code/indexer.js';
import { closeCodeDbForTests, getCodeDb, writePageRanks } from '../../../server/brain/code/schema.js';

const REPO = 'pagerank-test';
let homeDir = '';

/** Insert a symbol row with the columns the rank pass reads. */
function addSymbol(db, id, file) {
  db.prepare(
    `INSERT INTO symbols (id, repo, kind, name, file, line_start, line_end)
     VALUES (?, ?, 'function', ?, ?, 1, 2)`,
  ).run(id, REPO, id.split(':').pop(), file);
}

describe('writePageRanks', () => {
  before(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-pagerank-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(() => {
    closeCodeDbForTests();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('persists scores from a Map (not just a plain object)', () => {
    const db = getCodeDb(REPO);
    addSymbol(db, `${REPO}:alpha`, 'a.ts');
    addSymbol(db, `${REPO}:beta`, 'b.ts');

    const updated = writePageRanks(
      db,
      new Map([
        [`${REPO}:alpha`, 0.75],
        [`${REPO}:beta`, 0.25],
      ]),
    );

    assert.equal(updated, 2);
    const rows = db
      .prepare('SELECT id, pagerank FROM symbols WHERE repo = ? ORDER BY id')
      .all(REPO);
    assert.equal(rows[0].pagerank, 0.75);
    assert.equal(rows[1].pagerank, 0.25);
  });

  it('still accepts a plain object', () => {
    const db = getCodeDb(REPO);
    const updated = writePageRanks(db, { [`${REPO}:alpha`]: 0.5 });
    assert.equal(updated, 1);
    assert.equal(
      db.prepare('SELECT pagerank FROM symbols WHERE id = ?').get(`${REPO}:alpha`).pagerank,
      0.5,
    );
  });

  it('recomputePageRank gives called symbols a non-zero rank', () => {
    const db = getCodeDb(REPO);
    db.prepare('DELETE FROM symbols WHERE repo = ?').run(REPO);
    db.prepare('DELETE FROM edges').run();

    addSymbol(db, `${REPO}:caller`, 'a.ts');
    addSymbol(db, `${REPO}:callee`, 'a.ts');
    db.prepare('INSERT INTO edges (src_symbol, dst_symbol, kind) VALUES (?, ?, ?)').run(
      `${REPO}:caller`,
      `${REPO}:callee`,
      'calls',
    );

    const updated = recomputePageRank(db);
    assert.equal(updated, 2, 'both graph nodes should be written');

    const ranks = Object.fromEntries(
      db.prepare('SELECT id, pagerank FROM symbols WHERE repo = ?').all(REPO).map((r) => [r.id, r.pagerank]),
    );
    assert.ok(ranks[`${REPO}:callee`] > 0, 'callee must have a rank');
    assert.ok(
      ranks[`${REPO}:callee`] > ranks[`${REPO}:caller`],
      'an incoming call should outrank a leaf caller',
    );
  });
});

describe('personalizedPageRank', () => {
  it('returns a Map whose scores sum to about 1', () => {
    const edges = [
      { src_symbol: 'a', dst_symbol: 'b' },
      { src_symbol: 'b', dst_symbol: 'c' },
      { src_symbol: 'c', dst_symbol: 'b' },
    ];
    const { out, nodes } = buildAdjacency(edges);
    const personal = buildPersonalizationVector(
      nodes,
      [...nodes].map((id) => ({ id, file: 'x.ts', usage_count: 0 })),
      new Set(),
    );
    const ranks = personalizedPageRank(out, nodes, personal);

    assert.ok(ranks instanceof Map, 'contract the writer must handle');
    const total = [...ranks.values()].reduce((sum, v) => sum + v, 0);
    assert.ok(Math.abs(total - 1) < 0.05, `expected ~1, got ${total}`);
    assert.ok(ranks.get('b') > ranks.get('a'), 'b has two inbound edges');
  });
});
