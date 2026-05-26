import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { preserveLastToolCalls } from '../../src/benchmark/llm-driver.ts';
import type { ToolCall } from '../../src/types.ts';

const READ_FILE_CALL: ToolCall = {
  id: 'call-1',
  type: 'function',
  function: { name: 'read_file', arguments: '{"path":"package.json"}' },
};

describe('preserveLastToolCalls', () => {
  test('keeps prior batch when final turn has no tool calls', () => {
    const kept = preserveLastToolCalls([READ_FILE_CALL], []);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.function.name, 'read_file');
  });

  test('replaces when a later turn emits new calls', () => {
    const grepCall: ToolCall = {
      id: 'call-2',
      type: 'function',
      function: { name: 'grep', arguments: '{"pattern":"export"}' },
    };
    const kept = preserveLastToolCalls([READ_FILE_CALL], [grepCall]);
    assert.equal(kept[0]?.function.name, 'grep');
  });
});
