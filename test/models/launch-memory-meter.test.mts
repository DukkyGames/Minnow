import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLaunchMemoryMeterView, formatMemoryGb } from '../../src/models/launch-memory-meter.ts';
import type { ServeMemoryEstimate } from '../../src/models/serve-memory-estimate.ts';

function estimate(overrides: Partial<ServeMemoryEstimate> = {}): ServeMemoryEstimate {
  return {
    vramGb: 18.1,
    ramGb: 1,
    totalGb: 19.1,
    kvGbPer1kTokens: 0.15,
    layerCount: 32,
    geometrySource: 'gguf',
    ...overrides,
  };
}

const GPU_24 = { gpuVramGb: 24, availableRamGb: 31, totalRamGb: 64 };

describe('launch memory meter', () => {
  it('formats integers without a trailing decimal', () => {
    assert.equal(formatMemoryGb(24), '24');
    assert.equal(formatMemoryGb(18.1), '18.1');
    assert.equal(formatMemoryGb(0), '0');
  });

  it('shows VRAM and RAM against measured budgets', () => {
    const view = buildLaunchMemoryMeterView({ estimate: estimate(), hardware: GPU_24 });
    assert.equal(view.rows.length, 2);
    assert.equal(view.rows[0].label, 'VRAM');
    assert.equal(view.rows[0].valueText, '18.1 / 24 GB');
    assert.equal(view.rows[0].tone, 'ok');
    assert.equal(view.rows[1].label, 'RAM');
    assert.equal(view.rows[1].valueText, '1 / 31 GB');
    assert.equal(view.rows[1].tone, 'ok');
    assert.equal(view.tight, false);
    assert.equal(view.kvNote, '0.15 GB per 1k ctx');
    assert.equal(
      view.ariaLabel,
      'Estimated memory at launch: ~18.1 GB VRAM + ~1 GB RAM (0.15 GB per 1k ctx)',
    );
  });

  it('omits the RAM row when the host term is below the display floor', () => {
    const view = buildLaunchMemoryMeterView({
      estimate: estimate({ ramGb: 0.4, totalGb: 18.2 }),
      hardware: GPU_24,
    });
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0].id, 'vram');
    assert.equal(view.ariaLabel, 'Estimated memory at launch: ~18.1 GB VRAM (0.15 GB per 1k ctx)');
  });

  it('shows only RAM for a CPU-only estimate', () => {
    const view = buildLaunchMemoryMeterView({
      estimate: estimate({ vramGb: 0, ramGb: 8.4, totalGb: 8.4, kvGbPer1kTokens: 0 }),
      hardware: { gpuVramGb: 0, availableRamGb: 31, totalRamGb: 64 },
    });
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0].id, 'ram');
    assert.equal(view.rows[0].valueText, '8.4 / 31 GB');
    assert.equal(view.kvNote, null);
    assert.equal(view.ariaLabel, 'Estimated memory at launch: ~8.4 GB RAM');
  });

  it('leaves fill empty when hardware was not measured', () => {
    const view = buildLaunchMemoryMeterView({ estimate: estimate(), hardware: null });
    assert.equal(view.rows[0].valueText, '~18.1 GB');
    assert.equal(view.rows[0].ratio, null);
    assert.equal(view.rows[0].fill, 0);
    assert.equal(view.rows[0].tone, 'ok');
  });

  it('marks VRAM warn, tight, and over at the shipped cutoffs', () => {
    const warn = buildLaunchMemoryMeterView({
      estimate: estimate({ vramGb: 20.4, ramGb: 0.2, totalGb: 20.4 }),
      hardware: GPU_24,
    });
    const tight = buildLaunchMemoryMeterView({
      estimate: estimate({ vramGb: 22.08, ramGb: 0.2, totalGb: 22.08 }),
      hardware: GPU_24,
    });
    const over = buildLaunchMemoryMeterView({
      estimate: estimate({ vramGb: 25.2, ramGb: 0.2, totalGb: 25.2 }),
      hardware: GPU_24,
    });
    assert.equal(warn.rows[0].tone, 'warn');
    assert.equal(warn.rows[0].valueText, '20.4 / 24 GB');
    assert.equal(tight.rows[0].tone, 'tight');
    assert.equal(tight.tight, true);
    assert.equal(over.rows[0].tone, 'over');
    assert.equal(over.rows[0].fill, 1);
    assert.equal(
      over.caption,
      'This configuration may exceed the memory Minnow measured on this machine.',
    );
  });

  it('warns on RAM earlier than VRAM because leftover system memory is the budget', () => {
    const warn = buildLaunchMemoryMeterView({
      estimate: estimate({ vramGb: 0, ramGb: 13.95, totalGb: 13.95, kvGbPer1kTokens: 0 }),
      hardware: GPU_24,
    });
    const tight = buildLaunchMemoryMeterView({
      estimate: estimate({ vramGb: 0, ramGb: 17.05, totalGb: 17.05, kvGbPer1kTokens: 0 }),
      hardware: GPU_24,
    });
    assert.equal(warn.rows[0].valueText, '14 / 31 GB');
    assert.equal(warn.rows[0].tone, 'warn');
    assert.equal(tight.rows[0].valueText, '17.1 / 31 GB');
    assert.equal(tight.rows[0].tone, 'tight');
  });

  it('explains architecture estimates when the GGUF header is missing', () => {
    const view = buildLaunchMemoryMeterView({
      estimate: estimate({ geometrySource: 'family' }),
      hardware: GPU_24,
    });
    assert.equal(
      view.caption,
      "Estimated from this model's architecture and size. Exact numbers need the weights on disk.",
    );
  });
});
