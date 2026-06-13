import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getModels } from '../../src/models/catalog.ts';
import { rankModels } from '../../src/models/fit.ts';
import { paramsB } from '../../src/models/quant.ts';
import type { HardwareSnapshot } from '../../src/models/types.ts';

const RTX_4090_BOX: HardwareSnapshot = {
  os: 'linux',
  platform: 'linux',
  arch: 'x64',
  cpuName: 'Test CPU',
  cpuCores: 16,
  totalRamGb: 64,
  availableRamGb: 48,
  hasGpu: true,
  gpuName: 'NVIDIA GeForce RTX 4090',
  gpuVramGb: 24,
  gpuCount: 1,
  gpus: [{ index: 0, name: 'NVIDIA GeForce RTX 4090', vramGb: 24 }],
  gpuGroups: [
    {
      name: 'NVIDIA GeForce RTX 4090',
      vramEach: 24,
      count: 1,
      indices: [0],
      vramTotal: 24,
    },
  ],
  homogeneous: true,
  backend: 'cuda',
  unifiedMemory: false,
  detectedAt: 1,
};

describe('models quant', () => {
  test('paramsB treats bare hundreds as millions not billions', () => {
    assert.equal(paramsB({ parameter_count: '355' }), 0.355);
  });
});

describe('models catalog', () => {
  test('bundled catalog loads', () => {
    assert.ok(getModels().length > 100);
  });
});

describe('rankModels', () => {
  test('returns scored rows for fixed hardware', () => {
    const rows = rankModels(RTX_4090_BOX, { limit: 5 });
    assert.equal(rows.length, 5);
    assert.ok(rows[0].score >= rows[1].score);
    assert.ok(rows.every((r) => r.name.length > 0));
  });
});
