/**
 * Capability matrix probe runner (mocked LLM driver).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { OneShotResult } from '../../src/benchmark/llm-driver.ts';
import type { CapabilityRoundTelemetry } from '../../src/benchmark/capabilities/types.ts';
import type { ToolCall } from '../../src/types.ts';

const GET_DATETIME_CALL: ToolCall = {
  id: 'call-dt',
  type: 'function',
  function: { name: 'get_datetime', arguments: '{}' },
};

function baseOneShot(overrides: Partial<OneShotResult> = {}): OneShotResult {
  return {
    text: 'Benchmark answer without preamble.',
    contentText: 'Benchmark answer without preamble.',
    reasoningText: '',
    toolCalls: [],
    finishReason: 'stop',
    timing: {
      ttftMs: 12,
      totalMs: 40,
      tokPerSec: 100,
      usage: {},
      stats: {},
      streamChunkCount: 3,
    },
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

let toolLoopRounds: CapabilityRoundTelemetry[] = [];

mock.module('../../src/benchmark/llm-driver.ts', {
  namedExports: {
    runOneShot: async () => baseOneShot(),
    runToolLoop: async (input: {
      onRound?: (round: CapabilityRoundTelemetry) => void;
    }) => {
      const round: CapabilityRoundTelemetry = {
        round: 0,
        toolCalls: [{ function: GET_DATETIME_CALL.function }],
      };
      toolLoopRounds = [round];
      input.onRound?.(round);
      return baseOneShot({ toolCalls: [GET_DATETIME_CALL] });
    },
    preserveLastToolCalls: (prev: ToolCall[], next: ToolCall[]) =>
      next.length > 0 ? next : prev,
  },
});

const { getCapabilityById } = await import('../../src/benchmark/capabilities/catalog.ts');
const { runCapabilityProbe, capabilityTestFieldsFromVerdict } = await import(
  '../../src/benchmark/capabilities/run-probe.ts'
);
const { PHASE_2B_NO_REQUIREMENT_CAPABILITY_IDS } = await import(
  '../../src/benchmark/capabilities/probe-requirements.ts'
);

describe('runCapabilityProbe (phase 2b)', () => {
  const ctx = {
    providerId: 'fake-provider',
    modelId: 'fake-model',
    localServer: false,
    signal: new AbortController().signal,
  };

  test('phase 2b catalog ids are exactly six core-protocol probes', () => {
    assert.equal(PHASE_2B_NO_REQUIREMENT_CAPABILITY_IDS.length, 6);
    for (const id of PHASE_2B_NO_REQUIREMENT_CAPABILITY_IDS) {
      const cap = getCapabilityById(id);
      assert.ok(cap);
      assert.equal(cap?.scoreMode, 'auto');
      assert.equal(cap?.probe && 'requires' in cap.probe ? cap.probe.requires : undefined, undefined);
    }
  });

  for (const id of PHASE_2B_NO_REQUIREMENT_CAPABILITY_IDS) {
    test(`${id} returns a scored verdict when driver succeeds`, async () => {
      toolLoopRounds = [];
      const cap = getCapabilityById(id);
      assert.ok(cap?.probe && cap.probe.kind !== 'delegated');
      const result = await runCapabilityProbe(ctx, cap);
      assert.equal(result.skipped, false);
      assert.ok(['pass', 'partial', 'fail'].includes(result.verdict));
      const fields = capabilityTestFieldsFromVerdict(
        result.verdict as 'pass' | 'partial' | 'fail',
        result.reason,
      );
      assert.ok(fields.score >= 0);
    });
  }
});
