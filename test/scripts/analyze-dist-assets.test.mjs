import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assetBasenameFromHref,
  evaluateBundleBudgets,
  isDataPackChunk,
  isEntryJs,
  kbFromBytes,
  sumEagerJs,
} from '../../scripts/lib/analyze-dist-assets.mjs';

describe('analyze-dist-assets helpers', () => {
  it('detects entry and data-pack chunk names', () => {
    assert.equal(isEntryJs('index-abc123.js'), true);
    assert.equal(isEntryJs('store-abc.js'), false);
    assert.equal(isDataPackChunk('mmlu-mini-deadbeef.js'), true);
    assert.equal(isDataPackChunk('index-abc.js'), false);
  });

  it('resolves eager asset basenames from hrefs', () => {
    assert.equal(assetBasenameFromHref('/assets/index-abc.js'), 'index-abc.js');
    assert.equal(assetBasenameFromHref('./assets/vendor-x.js?v=1'), 'vendor-x.js');
    assert.equal(assetBasenameFromHref('/assets/index.css'), null);
  });

  it('sums eager JS chunk sizes', () => {
    const row = sumEagerJs(
      [
        { name: 'index-a.js', bytes: 1000, kb: kbFromBytes(1000) },
        { name: 'vendor-b.js', bytes: 2000, kb: kbFromBytes(2000) },
      ],
      ['index-a.js', 'vendor-b.js', 'missing.js'],
    );
    assert.ok(row);
    assert.equal(row.bytes, 3000);
    assert.equal(row.name, 'eager(2 chunks)');
  });

  it('flags budget breaches with positive delta', () => {
    const analysis = {
      entryJs: { name: 'index-x.js', bytes: 2000 * 1024, kb: 2000 },
      entryCss: { name: 'index-x.css', bytes: 100 * 1024, kb: 100 },
      largestLazyJs: { name: 'lazy.js', bytes: 500 * 1024, kb: 500 },
      eagerJs: { name: 'eager(2 chunks)', bytes: 1000 * 1024, kb: 1000 },
      totalAssetsBytes: 3000 * 1024,
      totalAssetsKb: kbFromBytes(3000 * 1024),
      dataPackJsChunks: [],
      allFiles: [],
      totals: { jsBytes: 0, cssBytes: 0, jsKb: 0, cssKb: 0 },
    };
    const breaches = evaluateBundleBudgets(analysis, {
      bundle: {
        entryJsMaxKb: 1500,
        entryCssMaxKb: 950,
        largestLazyJsMaxKb: 3200,
        eagerJsMaxKb: 6448,
        totalAssetsMaxKb: 9500,
      },
    });
    assert.equal(breaches.length, 1);
    assert.equal(breaches[0].metric, 'entryJs');
    assert.equal(breaches[0].deltaKb, 500);
  });

  it('flags eager JS breaches', () => {
    const analysis = {
      entryJs: { name: 'index-x.js', bytes: 100 * 1024, kb: 100 },
      entryCss: { name: 'index-x.css', bytes: 100 * 1024, kb: 100 },
      largestLazyJs: { name: 'lazy.js', bytes: 500 * 1024, kb: 500 },
      eagerJs: { name: 'eager(3 chunks)', bytes: 7000 * 1024, kb: 7000 },
      totalAssetsBytes: 3000 * 1024,
      totalAssetsKb: kbFromBytes(3000 * 1024),
      dataPackJsChunks: [],
      allFiles: [],
      totals: { jsBytes: 0, cssBytes: 0, jsKb: 0, cssKb: 0 },
    };
    const breaches = evaluateBundleBudgets(analysis, {
      bundle: {
        entryJsMaxKb: 1500,
        entryCssMaxKb: 950,
        largestLazyJsMaxKb: 3200,
        eagerJsMaxKb: 6448,
        totalAssetsMaxKb: 9500,
      },
    });
    assert.equal(breaches.length, 1);
    assert.equal(breaches[0].metric, 'eagerJs');
  });
});
