/**
 * Capability probe timeout enforcement.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { isAbortError } from '../../src/benchmark/abort.ts';
import { CAPABILITY_PROBE_BY_ID } from '../../src/benchmark/capabilities/probes.ts';
import type { CapabilityDefinition } from '../../src/benchmark/capabilities/types.ts';
import { DEFAULT_PROBE_TIMEOUT_MS } from '../../src/benchmark/types.ts';

mock.module('../../src/benchmark/llm-driver.ts', {
  namedExports: {
    runOneShot: () =>
      new Promise(() => {
        /* never settles */
      }),
    runToolLoop: () =>
      new Promise(() => {
        /* never settles */
      }),
  },
});

const { runCapabilityProbe } = await import('../../src/benchmark/capabilities/run-probe.ts');

function coreReasoningCap(): CapabilityDefinition {
  const probe = CAPABILITY_PROBE_BY_ID['core-reasoning'];
  assert.ok(probe);
  return {
    id: 'core-reasoning',
    groupId: 'core',
    label: 'Core reasoning',
    prompt: 'test',
    howToTest: 'test',
    probe,
  };
}

describe('runCapabilityProbe timeout', () => {
  test('hung driver resolves to fail verdict naming the timeout', async () => {
    const result = await runCapabilityProbe(
      {
        providerId: 'p',
        modelId: 'm',
        localServer: true,
        signal: new AbortController().signal,
        perTestTimeoutMs: 50,
      },
      coreReasoningCap(),
    );
    assert.equal(result.verdict, 'fail');
    assert.match(result.reason, /timed out after 0s/i);
  });

  test('aborted ctx.signal rethrows instead of writing a fail cell', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        runCapabilityProbe(
          {
            providerId: 'p',
            modelId: 'm',
            localServer: true,
            signal: controller.signal,
            perTestTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
          },
          coreReasoningCap(),
        ),
      (err: unknown) => isAbortError(err),
    );
  });
});
