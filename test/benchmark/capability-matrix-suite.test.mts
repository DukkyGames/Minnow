/**
 * Capability matrix suite integration (mocked provider + LLM driver).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { OneShotResult } from '../../src/benchmark/llm-driver.ts';
import type { CapabilityRoundTelemetry } from '../../src/benchmark/capabilities/types.ts';
import type { ToolCall } from '../../src/types.ts';
import { CAPABILITY_CATALOG } from '../../src/benchmark/capabilities/catalog.ts';
import {
  PHASE_2B_NO_REQUIREMENT_CAPABILITY_IDS,
  PHASE_2C_WORKSPACE_CAPABILITY_IDS,
  PHASE_2D_EMIT_ONLY_CAPABILITY_IDS,
  PHASE_2E_CONDITIONAL_CAPABILITY_IDS,
  PHASE_2F_DELEGATED_DERIVED_CAPABILITY_IDS,
} from '../../src/benchmark/capabilities/probe-wave-ids.ts';

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
      ttftMs: 10,
      totalMs: 30,
      tokPerSec: 80,
      usage: {},
      stats: {},
      streamChunkCount: 4,
    },
    messages: [],
    ...overrides,
  };
}

mock.module('../../src/providers/fetch-models.ts', {
  namedExports: {
    fetchModelsForProvider: async () => [],
  },
});

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
      input.onRound?.(round);
      return baseOneShot({ toolCalls: [GET_DATETIME_CALL] });
    },
    preserveLastToolCalls: (prev: ToolCall[], next: ToolCall[]) =>
      next.length > 0 ? next : prev,
  },
});

const { runCapabilityMatrixSuite } = await import('../../src/benchmark/suites/capability-matrix.ts');
const { listExpectedTestsForSuites } = await import('../../src/benchmark/test-catalog.ts');

describe('capability-matrix suite', () => {
  test('emits 67 rows; phase 2b autos run; manual and gated autos are n-a', async () => {
    const expected = listExpectedTestsForSuites(['capability-matrix']);
    assert.equal(expected.length, 67);

    const suite = await runCapabilityMatrixSuite({
      providerId: 'fake-provider',
      modelId: 'fake-model',
      localServer: false,
      signal: new AbortController().signal,
    });

    assert.equal(suite.id, 'capability-matrix');
    assert.equal(suite.tests.length, 67);

    assert.deepEqual(
      suite.tests.map((t) => t.testId),
      expected.map((e) => e.testId),
    );

    const manualIds = new Set(
      CAPABILITY_CATALOG.filter((c) => c.scoreMode === 'manual').map((c) => c.id),
    );
    const phase2b = new Set<string>(PHASE_2B_NO_REQUIREMENT_CAPABILITY_IDS);
    const phase2c = new Set<string>(PHASE_2C_WORKSPACE_CAPABILITY_IDS);
    const phase2d = new Set<string>(PHASE_2D_EMIT_ONLY_CAPABILITY_IDS);
    const phase2e = new Set<string>(PHASE_2E_CONDITIONAL_CAPABILITY_IDS);
    const phase2f = new Set<string>(PHASE_2F_DELEGATED_DERIVED_CAPABILITY_IDS);
    const phase2fNoReq = new Set(['mode-impeccable', 'features-skills']);
    const phase2fGated = new Set(['core-vision']);
    const phase2eNoReq = new Set([
      'agents-todo-write',
      'modes-general',
      'features-chat-title',
      'features-markdown',
    ]);
    const phase2eGated = new Set(
      PHASE_2E_CONDITIONAL_CAPABILITY_IDS.filter((id) => !phase2eNoReq.has(id)),
    );

    let manualSkipped = 0;
    let phase2bRun = 0;
    let phase2cSkipped = 0;
    let phase2dRun = 0;
    let phase2eRun = 0;
    let phase2eSkipped = 0;
    let phase2fRun = 0;
    let phase2fSkipped = 0;

    for (const row of suite.tests) {
      const capId = row.testId.replace('cap-matrix/', '');
      if (manualIds.has(capId)) {
        assert.equal(row.skipped, true);
        assert.equal(row.verdict, 'n-a');
        manualSkipped += 1;
        continue;
      }
      if (phase2b.has(capId)) {
        assert.equal(row.skipped, false, capId);
        assert.ok(row.verdict === 'pass' || row.verdict === 'partial' || row.verdict === 'fail');
        phase2bRun += 1;
        continue;
      }
      if (phase2c.has(capId)) {
        assert.equal(row.skipped, true, capId);
        assert.equal(row.verdict, 'n-a', capId);
        phase2cSkipped += 1;
        continue;
      }
      if (phase2d.has(capId)) {
        assert.equal(row.skipped, false, capId);
        assert.ok(row.verdict === 'pass' || row.verdict === 'partial' || row.verdict === 'fail', capId);
        phase2dRun += 1;
        continue;
      }
      if (phase2eNoReq.has(capId)) {
        assert.equal(row.skipped, false, capId);
        assert.ok(row.verdict === 'pass' || row.verdict === 'partial' || row.verdict === 'fail', capId);
        phase2eRun += 1;
        continue;
      }
      if (phase2eGated.has(capId)) {
        assert.equal(row.skipped, true, capId);
        assert.equal(row.verdict, 'n-a', capId);
        phase2eSkipped += 1;
        continue;
      }
      if (phase2fNoReq.has(capId)) {
        assert.equal(row.skipped, false, capId);
        assert.ok(row.verdict === 'pass' || row.verdict === 'partial' || row.verdict === 'fail', capId);
        phase2fRun += 1;
        continue;
      }
      if (phase2fGated.has(capId)) {
        assert.equal(row.skipped, true, capId);
        assert.equal(row.verdict, 'n-a', capId);
        phase2fSkipped += 1;
        continue;
      }
      assert.equal(row.skipped, true, capId);
      assert.equal(row.verdict, 'n-a', capId);
    }

    assert.equal(manualSkipped, 23);
    assert.equal(phase2bRun, 6);
    assert.equal(phase2cSkipped, 14);
    assert.equal(phase2dRun, 13);
    assert.equal(phase2eRun, 4);
    assert.equal(phase2eSkipped, 4);
    assert.equal(phase2e.size, phase2eRun + phase2eSkipped);
    assert.equal(phase2fRun, 2);
    assert.equal(phase2fSkipped, 1);
    assert.equal(phase2f.size, phase2fRun + phase2fSkipped);
    assert.ok(suite.score > 0);
  });
});
