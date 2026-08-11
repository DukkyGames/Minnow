/**
 * Delegated capability-matrix probes (phase 2f) with mocked LLM driver.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { OneShotResult } from '../../src/benchmark/llm-driver.ts';
import type { LmModelRecord, ToolCall } from '../../src/types.ts';

function baseOneShot(text: string): OneShotResult {
  return {
    text,
    contentText: text,
    reasoningText: '',
    toolCalls: [],
    finishReason: 'stop',
    timing: {
      ttftMs: 5,
      totalMs: 20,
      tokPerSec: 50,
      usage: {},
      stats: {},
      streamChunkCount: 3,
    },
    messages: [],
  };
}

const ctx = {
  providerId: 'fake',
  modelId: 'vision-model',
  localServer: false,
  signal: new AbortController().signal,
};

mock.module('../../src/benchmark/llm-driver.ts', {
  namedExports: {
    runOneShot: async () =>
      baseOneShot('Increase padding around the button and improve spacing against the card edge.'),
    runToolLoop: async () => baseOneShot('unused'),
    preserveLastToolCalls: (prev: ToolCall[], next: ToolCall[]) =>
      next.length > 0 ? next : prev,
  },
});

const { CAPABILITY_CATALOG, getCapabilityById } = await import(
  '../../src/benchmark/capabilities/catalog.ts',
);
const { assertAllAutoCapabilitiesWired, resolveCapabilityProbeSkip } = await import(
  '../../src/benchmark/capabilities/probe-requirements.ts',
);
const { runDelegatedCapabilityProbe } = await import(
  '../../src/benchmark/capabilities/delegated-probes.ts',
);
const { runCapabilityProbe } = await import('../../src/benchmark/capabilities/run-probe.ts');

describe('delegated capability probes (phase 2f)', () => {
  test('all 44 auto capabilities are assigned to a probe wave', () => {
    assert.doesNotThrow(() => assertAllAutoCapabilitiesWired(CAPABILITY_CATALOG));
  });

  test('core-vision resolves skip only on vision requirement', async () => {
    const cap = getCapabilityById('core-vision');
    assert.ok(cap);
    const blocked = await resolveCapabilityProbeSkip(cap!, {
      ctx: { ...ctx, modelId: 'text-only' },
      catalogModels: [
        {
          id: 'text-only',
          type: 'llm',
          capabilities: {
            vision: false,
            tools: null,
            streaming: null,
            grammar: null,
            reasoning: null,
            contextLength: null,
            loadState: null,
          },
        },
      ],
    });
    assert.match(blocked ?? '', /vision/i);

    const visionCatalog: LmModelRecord[] = [{ id: 'vision-model', type: 'vlm' }];
    const ready = await resolveCapabilityProbeSkip(cap!, {
      ctx,
      catalogModels: visionCatalog,
    });
    assert.equal(ready, null);
  });

  test('runDelegatedCapabilityProbe scores cap-multimodal via shared runner', async () => {
    const result = await runDelegatedCapabilityProbe(ctx, {
      kind: 'delegated',
      suiteId: 'capability',
      testId: 'cap-multimodal',
      requires: ['vision'],
    });
    assert.equal(result.skipped, false);
    assert.equal(result.verdict, 'pass');
  });

  test('runDelegatedCapabilityProbe runs impeccable skill probe', async () => {
    const result = await runDelegatedCapabilityProbe(ctx, {
      kind: 'delegated',
      suiteId: 'skills',
      testId: 'skill-impeccable',
    });
    assert.equal(result.skipped, false);
    assert.equal(result.verdict, 'pass');
  });

  test('runCapabilityProbe routes features-skills delegation', async () => {
    const cap = getCapabilityById('features-skills');
    assert.ok(cap?.probe && cap.probe.kind === 'delegated');
    const result = await runCapabilityProbe(ctx, cap);
    assert.equal(result.skipped, false);
    assert.equal(result.verdict, 'pass');
  });
});
