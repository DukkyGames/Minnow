import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getModels } from '../../src/models/catalog.ts';
import {
  defaultGpuGroupIndex,
  hardwareForGpuBudget,
  rankModels,
  resolveGpuGroupIndexAfterRescan,
} from '../../src/models/fit.ts';
import { inferUseCase, paramsB, estimateFileSizeGb } from '../../src/models/quant.ts';
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

  test('estimateFileSizeGb uses quant bytes-per-param', () => {
    assert.equal(estimateFileSizeGb(7, 'Q4_K_M'), 3.5);
    assert.equal(estimateFileSizeGb(8, 'Q8_0'), 8);
  });
});

describe('models catalog', () => {
  test('bundled catalog loads', async () => {
    assert.ok((await getModels()).length > 100);
  });
});

describe('rankModels', () => {
  test('returns scored rows for fixed hardware', async () => {
    const rows = await rankModels(RTX_4090_BOX, { limit: 5 });
    assert.equal(rows.length, 5);
    assert.ok(rows[0].score >= rows[1].score);
    assert.ok(rows.every((r) => r.name.length > 0));
    assert.ok(rows.every((r) => r.size_gb > 0));
  });

  test('GPU budget RAM-only disables GPU for ranking', async () => {
    const ramOnly = hardwareForGpuBudget(RTX_4090_BOX, 0);
    assert.equal(ramOnly.hasGpu, false);
    assert.equal(ramOnly.gpuVramGb, 0);
    assert.equal(ramOnly.gpuCount, 0);
    assert.equal(ramOnly.gpu_only, false);

    const gpuRows = await rankModels(hardwareForGpuBudget(RTX_4090_BOX, 1), {
      limit: 20,
      fitOnly: true,
    });
    const ramRows = await rankModels(ramOnly, { limit: 20, fitOnly: true });
    assert.notDeepEqual(
      gpuRows.map((r) => r.name),
      ramRows.map((r) => r.name),
    );
  });

  test('defaultGpuGroupIndex prefers GPU when groups exist', () => {
    assert.equal(defaultGpuGroupIndex(RTX_4090_BOX), 1);
    assert.equal(
      defaultGpuGroupIndex({ ...RTX_4090_BOX, gpuGroups: [], hasGpu: false }),
      0,
    );
  });

  test('resolveGpuGroupIndexAfterRescan keeps valid selection', () => {
    assert.equal(resolveGpuGroupIndexAfterRescan(RTX_4090_BOX, 1), 1);
    assert.equal(resolveGpuGroupIndexAfterRescan(RTX_4090_BOX, 0), 0);
    assert.equal(resolveGpuGroupIndexAfterRescan(RTX_4090_BOX, 99), 1);
  });

  test('fitOnly false reserves too_tight rows inside the limit', async () => {
    const withFit = await rankModels(RTX_4090_BOX, { limit: 60, fitOnly: true });
    const withoutFit = await rankModels(RTX_4090_BOX, { limit: 60, fitOnly: false });
    const tightInWithout = withoutFit.filter((r) => r.fit_level === 'too_tight');

    assert.ok(withFit.every((r) => r.fit_level !== 'too_tight'));
    assert.ok(tightInWithout.length > 0, 'unchecked Fit only should surface too_tight rows');
    assert.notDeepEqual(
      withFit.map((r) => r.name),
      withoutFit.map((r) => r.name),
      'toggling Fit only should change the visible catalog slice',
    );
  });

  test('useCase filter matches inferUseCase keys not catalog labels', async () => {
    const reasoningModel = (await getModels()).find((m) => inferUseCase(m) === 'reasoning');
    assert.ok(reasoningModel, 'catalog should include a reasoning model');

    const catalogLabel = reasoningModel.use_case ?? '';
    assert.notEqual(catalogLabel, 'reasoning', 'catalog labels are human-readable strings');

    const byKey = await rankModels(RTX_4090_BOX, {
      limit: 200,
      fitOnly: false,
      useCase: 'reasoning',
    });
    assert.ok(byKey.some((r) => r.name === reasoningModel.name));

    const byCatalogLabel = await rankModels(RTX_4090_BOX, {
      limit: 200,
      fitOnly: false,
      useCase: catalogLabel,
    });
    assert.equal(
      byCatalogLabel.some((r) => r.name === reasoningModel.name),
      false,
      'catalog use_case strings must not be passed as filter values',
    );
  });
});
