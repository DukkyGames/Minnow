import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EditorState, Text } from '@codemirror/state';
import {
  mapPendingResolveThroughTransaction,
  mapPendingThroughTransactions,
} from '../../../src/ui/editor-suggestions/intent-pending.ts';
import { mapRegionsThroughTransaction } from '../../../src/ui/editor-suggestions/intent-regions.ts';
import {
  neighborLinesForPrompt,
  resolvedNeighborLines,
} from '../../../src/ui/editor-suggestions/intent-context.ts';

describe('mapPendingResolveThroughTransaction', () => {
  test('drops pending resolve when a line is inserted at the start of the anchor', () => {
    const start = EditorState.create({ doc: 'intent line here\n' });
    const pending = { from: 0, to: 16, intentText: 'intent line here' };

    const tr = start.update({
      changes: { from: 0, insert: '// above\n' },
    });
    const mapped = mapPendingResolveThroughTransaction(pending, tr);
    assert.equal(mapped, null);
  });

  test('maps pending resolve when edits occur below the anchor line', () => {
    const start = EditorState.create({ doc: 'intent line here\n' });
    const pending = { from: 0, to: 16, intentText: 'intent line here' };

    const tr = start.update({
      changes: { from: 17, insert: 'tail\n' },
    });
    const mapped = mapPendingResolveThroughTransaction(pending, tr);
    assert.deepEqual(mapped, pending);
  });

  test('drops pending resolve when the intent text on the line is edited', () => {
    const start = EditorState.create({ doc: 'intent line here\n' });
    const pending = { from: 0, to: 16, intentText: 'intent line here' };

    const tr = start.update({
      changes: { from: 6, to: 10, insert: 'XXXX' },
    });
    const mapped = mapPendingResolveThroughTransaction(pending, tr);
    assert.equal(mapped, null);
  });
});

describe('mapRegionsThroughTransaction', () => {
  test('drops accepted regions intersected by user edits', () => {
    const start = EditorState.create({
      doc: 'const x = 1;\n',
    });
    const region = {
      from: 0,
      to: 12,
      intentText: 'set x to 1',
      ctxHash: 'h',
      stale: false,
    };
    const tr = start.update({
      changes: { from: 6, to: 7, insert: '9' },
    });
    const next = mapRegionsThroughTransaction([region], tr, 5);
    assert.equal(next.length, 0);
  });
});

describe('neighborLinesForPrompt', () => {
  test('returns actual source neighbors within the window', () => {
    const doc = Text.of(['import x', 'intent line', 'tail']);
    const { above, below } = neighborLinesForPrompt(doc, 2, 2);
    assert.deepEqual(above, ['import x']);
    assert.deepEqual(below, ['tail']);
  });

  test('resolvedNeighborLines only includes resolved line numbers for hashing', () => {
    const doc = Text.of(['resolved', 'intent', 'other']);
    const resolved = new Set([1]);
    const { above, below } = resolvedNeighborLines(doc, 2, resolved, 2);
    assert.deepEqual(above, ['resolved']);
    assert.deepEqual(below, []);
  });
});

describe('mapPendingThroughTransactions', () => {
  test('folds multiple transactions', () => {
    const start = EditorState.create({ doc: 'intent line\n' });
    const pending = { from: 0, to: 11, intentText: 'intent line' };
    const tr1 = start.update({ changes: { from: 12, insert: 'z' } });
    const tr2 = tr1.state.update({ changes: { from: 13, insert: 'y' } });
    const mapped = mapPendingThroughTransactions(pending, [tr1, tr2]);
    assert.deepEqual(mapped, pending);
  });
});
