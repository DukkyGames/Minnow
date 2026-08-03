/**
 * Sliding-window repetition detection — duplicates must be bunched, not merely frequent.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  detectRepetition,
  resolveRepetitionWindow,
  MIN_REPETITION_WINDOW,
  type ToolCallLogEntry,
} from '../../src/agents/self-healing/detector.ts';

const THRESHOLDS = { duplicateToolCallThreshold: 5, sameErrorThreshold: 3 };

function call(name: string, args: Record<string, unknown>): ToolCallLogEntry {
  return { name, argsJson: JSON.stringify(args) };
}

/** n identical calls in a row. */
function repeat(entry: ToolCallLogEntry, n: number): ToolCallLogEntry[] {
  return Array.from({ length: n }, () => entry);
}

/** n distinct calls, so nothing in the filler can itself trip the detector. */
function filler(n: number, prefix = 'f'): ToolCallLogEntry[] {
  return Array.from({ length: n }, (_, i) => call('read_file', { path: `${prefix}${i}.ts` }));
}

describe('repetition detector window', () => {
  test('resolveRepetitionWindow floors at MIN_REPETITION_WINDOW', () => {
    assert.equal(resolveRepetitionWindow(1), MIN_REPETITION_WINDOW);
    assert.equal(resolveRepetitionWindow(2), MIN_REPETITION_WINDOW);
  });

  test('resolveRepetitionWindow scales with the threshold', () => {
    assert.equal(resolveRepetitionWindow(5), 20);
    assert.equal(resolveRepetitionWindow(10), 40);
  });

  test('resolveRepetitionWindow honours an explicit size but never below the threshold', () => {
    assert.equal(resolveRepetitionWindow(5, 30), 30);
    assert.equal(resolveRepetitionWindow(8, 3), 8);
  });

  test('flags a tight loop of identical calls', () => {
    const log = [...filler(6), ...repeat(call('grep', { pattern: 'todo' }), 5)];
    const hit = detectRepetition(log, THRESHOLDS);
    assert.equal(hit?.reason, 'duplicate_tool');
  });

  test('ignores repeats spread across a long run', () => {
    // Five reads of the same plan file, 30 unrelated calls apart — normal reviewer work.
    const same = call('read_file', { path: 'plan.md' });
    const log: ToolCallLogEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      log.push(same, ...filler(30, `w${i}_`));
    }
    assert.equal(detectRepetition(log, THRESHOLDS), null);
  });

  test('still flags the loop when it starts after a long clean run', () => {
    const log = [
      ...filler(200),
      ...repeat(call('git_status', {}), 5),
    ];
    const hit = detectRepetition(log, THRESHOLDS);
    assert.equal(hit?.reason, 'duplicate_tool');
  });

  test('does not flag when duplicates straddle the window edge', () => {
    // 3 early + 2 late, with a full window of distinct calls in between.
    const same = call('git_log', { limit: 5 });
    const log = [...repeat(same, 3), ...filler(25), ...repeat(same, 2)];
    assert.equal(detectRepetition(log, THRESHOLDS), null);
  });

  test('threshold 0 disables detection regardless of window', () => {
    const log = repeat(call('grep', { pattern: 'x' }), 50);
    assert.equal(
      detectRepetition(log, { duplicateToolCallThreshold: 0, sameErrorThreshold: 3 }),
      null,
    );
  });

  test('argument order does not defeat the match', () => {
    const log = [
      ...filler(6),
      ...Array.from({ length: 5 }, (_, i) =>
        i % 2 === 0
          ? { name: 'search_in_file', argsJson: '{"a":1,"b":2}' }
          : { name: 'search_in_file', argsJson: '{"b":2,"a":1}' },
      ),
    ];
    const hit = detectRepetition(log, THRESHOLDS);
    assert.equal(hit?.reason, 'duplicate_tool');
  });
});
