import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { preserveLastToolCalls } from '../../src/benchmark/llm-driver.ts';
import type { CapabilityRoundTelemetry } from '../../src/benchmark/capabilities/types.ts';
import type { ToolCall } from '../../src/types.ts';

function roundTelemetryFromToolCalls(
  round: number,
  toolCalls: ToolCall[],
): CapabilityRoundTelemetry {
  return {
    round,
    toolCalls: toolCalls.map((tc) => ({
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  };
}

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

describe('capability round telemetry shape (tool loop onRound)', () => {
  test('maps tool call name and arguments for probes', () => {
    const telemetry = roundTelemetryFromToolCalls(0, [READ_FILE_CALL]);
    assert.equal(telemetry.round, 0);
    assert.equal(telemetry.toolCalls.length, 1);
    assert.equal(telemetry.toolCalls[0]?.function.name, 'read_file');
    assert.equal(telemetry.toolCalls[0]?.function.arguments, '{"path":"package.json"}');
  });
});
