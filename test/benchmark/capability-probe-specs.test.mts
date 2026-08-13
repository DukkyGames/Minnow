/**
 * Capability probe spec integrity: offered tools exist, prompts are authored, and mode
 * probes stay inside their mode's tool policy.
 *
 * These guard the failure mode that made several rows unscoreable: a spec naming a tool
 * id the catalog does not have (`brain_ingest`, `issue_create`) is silently dropped from
 * the request, so the model is judged on a tool it was never offered.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAPABILITY_CATALOG } from '../../src/benchmark/capabilities/catalog.ts';
import { CAPABILITY_PROBE_BY_ID } from '../../src/benchmark/capabilities/probes.ts';
import { hasCapabilityProbePrompt } from '../../src/benchmark/capabilities/probe-prompts.ts';
import { probeWaveForCapabilityId } from '../../src/benchmark/capabilities/probe-wave-ids.ts';
import type {
  CapabilityProbeSpec,
  CapabilityProbeSpecBase,
} from '../../src/benchmark/capabilities/types.ts';
import { getToolById } from '../../src/tools/definitions.ts';

function runnableSpecs(): [string, CapabilityProbeSpecBase][] {
  return Object.entries(CAPABILITY_PROBE_BY_ID)
    .filter(([, spec]: [string, CapabilityProbeSpec]) => spec.kind !== 'delegated')
    .map(([id, spec]) => [id, spec as CapabilityProbeSpecBase]);
}

describe('capability probe specs', () => {
  test('every offered tool id exists in the built-in catalog', () => {
    for (const [id, spec] of runnableSpecs()) {
      for (const toolId of [...(spec.toolIds ?? []), ...(spec.trapToolIds ?? [])]) {
        assert.ok(getToolById(toolId), `${id}: unknown tool id "${toolId}"`);
      }
    }
  });

  test('tool-driven probes offer at least one tool', () => {
    for (const [id, spec] of runnableSpecs()) {
      if (spec.kind === 'text' || spec.kind === 'stream') continue;
      const offered = [...(spec.toolIds ?? []), ...(spec.trapToolIds ?? [])];
      assert.ok(offered.length > 0, `${id}: ${spec.kind} probe offers no tools`);
    }
  });

  test('every auto capability has an authored probe prompt', () => {
    for (const cap of CAPABILITY_CATALOG) {
      if (cap.scoreMode !== 'auto') continue;
      // Delegated rows carry their prompt in the suite they delegate to.
      if (cap.probe?.kind === 'delegated') continue;
      assert.ok(hasCapabilityProbePrompt(cap.id), `${cap.id}: no authored prompt`);
    }
  });

  test('every auto capability is wired to a probe wave', () => {
    for (const cap of CAPABILITY_CATALOG) {
      if (cap.scoreMode !== 'auto') continue;
      assert.ok(probeWaveForCapabilityId(cap.id), `${cap.id}: no probe wave`);
    }
  });

  test('long-context prompt never contains the needle it asks for', async () => {
    const { buildLongContextPrompt } = await import(
      '../../src/benchmark/capabilities/probe-prompts.ts'
    );
    const { CAP_MATRIX_HAYSTACK_NEEDLE, CAP_MATRIX_HAYSTACK_LABEL } = await import(
      '../../src/benchmark/capabilities/fixture-paths.ts'
    );
    const prompt = buildLongContextPrompt();
    // Exactly one occurrence: the buried line. The instruction must reference the label.
    const occurrences = prompt.split(CAP_MATRIX_HAYSTACK_NEEDLE).length - 1;
    assert.equal(occurrences, 1);
    assert.ok(prompt.includes(`${CAP_MATRIX_HAYSTACK_LABEL}:`));
    // Comfortably past the 32k-token bar the row is named for (~4 chars per token).
    assert.ok(prompt.length > 32_000 * 4, `prompt only ${prompt.length} chars`);
    const needleAt = prompt.indexOf(CAP_MATRIX_HAYSTACK_NEEDLE) / prompt.length;
    assert.ok(needleAt > 0.4 && needleAt < 0.9, `needle at ${needleAt.toFixed(2)} of prompt`);
  });
});
