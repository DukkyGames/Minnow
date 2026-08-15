import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAPABILITY_CATALOG } from '../../src/benchmark/capabilities/catalog.ts';
import {
  capabilityIdsFromProbeKeys,
  probeWaveForCapability,
  resolveMatrixRunFilterSkip,
} from '../../src/benchmark/capabilities/matrix-run-filters.ts';

describe('matrix-run-filters', () => {
  test('probeWaveForCapability maps core-streaming to 2b', () => {
    const cap = CAPABILITY_CATALOG.find((row) => row.id === 'core-streaming');
    assert.ok(cap);
    assert.equal(probeWaveForCapability(cap), '2b');
  });

  test('group filter skips rows outside selection', () => {
    const cap = CAPABILITY_CATALOG.find((row) => row.id === 'core-streaming');
    assert.ok(cap);
    const reason = resolveMatrixRunFilterSkip(cap, {
      groupIds: ['files'],
    });
    assert.equal(reason, 'filtered (capability group)');
  });

  test('skipScored respects capability id list', () => {
    const cap = CAPABILITY_CATALOG.find((row) => row.id === 'core-streaming');
    assert.ok(cap);
    const reason = resolveMatrixRunFilterSkip(cap, {
      skipScored: true,
      skipCapabilityIds: ['core-streaming'],
    });
    assert.equal(reason, 'already scored');
  });

  test('capabilityIdsFromProbeKeys filters probe keys by target', () => {
    const targetKey = 'openai::gpt-test';
    const keys = [
      `${targetKey}::core-streaming`,
      'other::core-streaming',
      `${targetKey}::core-tool-calling`,
    ];
    const ids = capabilityIdsFromProbeKeys(keys, targetKey);
    assert.deepEqual(ids.sort(), ['core-streaming', 'core-tool-calling']);
  });
});
