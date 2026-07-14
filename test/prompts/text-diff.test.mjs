import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('text-diff', () => {
  test('buildLineDiff marks add and remove lines', async () => {
    const { buildLineDiff, promptsMatchForDiff } = await import(
      '../../src/chat/prompts/text-diff.ts'
    );
    const lines = buildLineDiff('alpha\nbeta', 'alpha\ngamma');
    assert.ok(lines.some((l) => l.type === 'remove' && l.text === 'beta'));
    assert.ok(lines.some((l) => l.type === 'add' && l.text === 'gamma'));
    assert.ok(lines.some((l) => l.type === 'unchanged' && l.text === 'alpha'));
    assert.equal(promptsMatchForDiff('same\n', 'same'), true);
  });

  test('identical prompts match after normalize', async () => {
    const { buildLineDiff, promptsMatchForDiff } = await import(
      '../../src/chat/prompts/text-diff.ts'
    );
    assert.equal(promptsMatchForDiff('a\r\nb', 'a\nb'), true);
    const lines = buildLineDiff('only', 'only');
    assert.ok(lines.every((l) => l.type === 'unchanged'));
  });

  test('empty baseline vs content', async () => {
    const { buildLineDiff } = await import('../../src/chat/prompts/text-diff.ts');
    const lines = buildLineDiff('', 'hello');
    assert.ok(lines.some((l) => l.type === 'add'));
  });

  test('countLineChangeStats matches buildLineDiff counts', async () => {
    const { buildLineDiff, countLineChangeStats } = await import(
      '../../src/chat/prompts/text-diff.ts'
    );
    const baseline = 'one\ntwo\nthree';
    const current = 'one\nfour\nthree';
    const stats = countLineChangeStats(baseline, current);
    const lines = buildLineDiff(baseline, current);
    const adds = lines.filter((l) => l.type === 'add').length;
    const dels = lines.filter((l) => l.type === 'remove').length;
    assert.equal(stats.additions, adds);
    assert.equal(stats.deletions, dels);
  });

  test('toChangedLinesWithNumbers skips context and numbers edits', async () => {
    const { buildLineDiff, toChangedLinesWithNumbers } = await import(
      '../../src/chat/prompts/text-diff.ts'
    );
    const lines = buildLineDiff('a\nb\nc', 'a\nx\nc');
    const changed = toChangedLinesWithNumbers(lines);
    assert.equal(changed.length, 2);
    assert.deepEqual(changed[0], { type: 'remove', text: 'b', lineNumber: 2 });
    assert.deepEqual(changed[1], { type: 'add', text: 'x', lineNumber: 2 });
  });
});
