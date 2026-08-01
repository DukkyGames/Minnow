import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateBundleBudgets,
  isDataPackChunk,
  isEntryJs,
  kbFromBytes,
} from '../../scripts/lib/analyze-dist-assets.mjs';

describe('analyze-dist-assets helpers', () => {
  it('detects entry and data-pack chunk names', () => {
    assert.equal(isEntryJs('index-abc123.js'), true);
    assert.equal(isEntryJs('store-abc.js'), false);
    assert.equal(isDataPackChunk('mmlu-mini-deadbeef.js'), true);
    assert.equal(isDataPackChunk('index-abc.js'), false);
  });

  it('flags budget breaches with positive delta', () => {
    const analysis = {
      entryJs: { name: 'index-x.js', bytes: 2000 * 1024, kb: 2000 },
      entryCss: { name: 'index-x.css', bytes: 100 * 1024, kb: 100 },
      largestLazyJs: { name: 'lazy.js', bytes: 500 * 1024, kb: 500 },
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
        totalAssetsMaxKb: 9500,
      },
    });
    assert.equal(breaches.length, 1);
    assert.equal(breaches[0].metric, 'entryJs');
    assert.equal(breaches[0].deltaKb, 500);
  });
});
