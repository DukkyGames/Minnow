import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { detectRepetition } from '../../src/agents/self-healing/detector.ts';

describe('self-healing detector', () => {
  test('duplicate tool calls trigger repetition', () => {
    const log = [
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
    ];
    const result = detectRepetition(log, {
      duplicateToolCallThreshold: 3,
      sameErrorThreshold: 3,
    });
    assert.ok(result);
    assert.equal(result?.reason, 'duplicate_tool');
    assert.equal(result?.repeated, true);
  });

  test('different args do not trigger', () => {
    const log = [
      { name: 'read_file', argsJson: '{"path":"a.ts"}' },
      { name: 'read_file', argsJson: '{"path":"b.ts"}' },
      { name: 'read_file', argsJson: '{"path":"c.ts"}' },
    ];
    const result = detectRepetition(log, {
      duplicateToolCallThreshold: 3,
      sameErrorThreshold: 3,
    });
    assert.equal(result, null);
  });
});
