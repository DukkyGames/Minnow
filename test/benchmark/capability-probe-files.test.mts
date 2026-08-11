/**
 * Capability matrix files probe (mocked LLM driver).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { OneShotResult } from '../../src/benchmark/llm-driver.ts';
import type { CapabilityRoundTelemetry } from '../../src/benchmark/capabilities/types.ts';
import type { ToolCall } from '../../src/types.ts';

/** Matches `CAP_MATRIX_JSON_PATH` in fixtures-workspace (avoid importing fixtures before mocks). */
const CAP_MATRIX_JSON_PATH = 'matrix/a/b/c.json';

const LIST_CALL: ToolCall = {
  id: 'call-list',
  type: 'function',
  function: { name: 'list_directory', arguments: JSON.stringify({ path: 'matrix' }) },
};

const READ_CALL: ToolCall = {
  id: 'call-read',
  type: 'function',
  function: { name: 'read_file', arguments: JSON.stringify({ path: CAP_MATRIX_JSON_PATH }) },
};

function baseOneShot(overrides: Partial<OneShotResult> = {}): OneShotResult {
  return {
    text: 'Listed matrix and read fixture json.',
    contentText: 'Listed matrix and read fixture json.',
    reasoningText: '',
    toolCalls: [LIST_CALL, READ_CALL],
    finishReason: 'stop',
    timing: {
      ttftMs: 8,
      totalMs: 24,
      tokPerSec: 90,
      usage: {},
      stats: {},
      streamChunkCount: 2,
    },
    messages: [],
    ...overrides,
  };
}

mock.module('../../src/benchmark/llm-driver.ts', {
  namedExports: {
    runOneShot: async () => baseOneShot(),
    runToolLoop: async (input: {
      messages: Array<{ content: string }>;
      onRound?: (round: CapabilityRoundTelemetry) => void;
    }) => {
      const round: CapabilityRoundTelemetry = {
        round: 0,
        toolCalls: [LIST_CALL, READ_CALL].map((c) => ({ function: c.function })),
      };
      input.onRound?.(round);
      assert.match(String(input.messages[0]?.content), /matrix\/a\/b\/c\.json/);
      return baseOneShot();
    },
    preserveLastToolCalls: (prev: ToolCall[], next: ToolCall[]) =>
      next.length > 0 ? next : prev,
  },
});

const { getCapabilityById } = await import('../../src/benchmark/capabilities/catalog.ts');
const { runCapabilityProbe } = await import('../../src/benchmark/capabilities/run-probe.ts');

describe('runCapabilityProbe files-list-read (phase 2c)', () => {
  test('passes when list_directory and read_file are emitted', async () => {
    const cap = getCapabilityById('files-list-read');
    assert.ok(cap);
    const result = await runCapabilityProbe(
      {
        providerId: 'fake',
        modelId: 'fake',
        localServer: true,
        signal: new AbortController().signal,
      },
      cap!,
      { workspaceRoot: '/tmp/bench' },
    );
    assert.equal(result.skipped, false);
    assert.equal(result.verdict, 'pass');
  });
});
