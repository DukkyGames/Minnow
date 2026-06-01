import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateExpertLabTokenCount } from '../../src/ui/expert-lab-page.ts';

describe('estimateExpertLabTokenCount', () => {
  it('returns 0 for empty or whitespace', () => {
    assert.equal(estimateExpertLabTokenCount(''), 0);
    assert.equal(estimateExpertLabTokenCount('   \n'), 0);
  });

  it('counts space-separated words', () => {
    assert.equal(estimateExpertLabTokenCount('hello world'), 2);
    assert.equal(estimateExpertLabTokenCount('  one   two  three '), 3);
  });
});
