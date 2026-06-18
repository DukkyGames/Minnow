import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  changeIntersectsRegion,
  contextHash,
  resolvedContext,
  resolvedLineIndices,
  simpleHash,
  withStale,
} from '../../../src/ui/editor-intent-mode/context.ts';
import { systemPromptForIntent } from '../../../src/ui/editor-intent-mode/resolver.ts';

describe('editor intent mode context', () => {
  test('resolvedContext collects neighbor resolved lines within window', () => {
    const lines = ['a', 'intent', 'c', 'd'];
    const regions = [
      { from: 0, to: 1, intentText: 'a', ctxHash: '1', stale: false },
      { from: 2, to: 8, intentText: 'intent', ctxHash: '2', stale: false },
      { from: 9, to: 10, intentText: 'c', ctxHash: '3', stale: false },
    ];
    const docText = lines.join('\n');
    const resolved = resolvedLineIndices(docText, regions);
    const ctx = resolvedContext(lines, 1, resolved, 2);
    assert.deepEqual(ctx.above, ['a']);
    assert.deepEqual(ctx.below, ['c']);
  });

  test('contextHash is stable for the same input', () => {
    const h1 = contextHash(['line1'], 'intent', ['line3']);
    const h2 = contextHash(['line1'], 'intent', ['line3']);
    assert.equal(h1, h2);
    assert.equal(typeof simpleHash('test'), 'string');
  });

  test('withStale flags regions when neighbor context drifts', () => {
    const doc = ['resolved-a', 'middle', 'resolved-c'].join('\n');
    const regions = [
      {
        from: 0,
        to: 10,
        intentText: 'make a',
        ctxHash: 'stale-on-purpose',
        stale: false,
      },
    ];
    const next = withStale(doc, regions, 2);
    assert.equal(next[0].stale, true);
  });

  test('changeIntersectsRegion detects overlap', () => {
    assert.equal(changeIntersectsRegion(5, 8, 0, 10), true);
    assert.equal(changeIntersectsRegion(11, 12, 0, 10), false);
  });
});

describe('editor intent mode resolver prompt', () => {
  test('systemPromptForIntent includes language label from path', () => {
    const prompt = systemPromptForIntent('src/app.tsx');
    assert.match(prompt, /TypeScript|TSX|JavaScript/i);
    assert.match(prompt, /ONLY the code/i);
  });
});
