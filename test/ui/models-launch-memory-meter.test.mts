import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { ServeMemoryEstimate } from '../../src/models/serve-memory-estimate.ts';

const ESTIMATE: ServeMemoryEstimate = {
  vramGb: 18.1,
  ramGb: 1,
  totalGb: 19.1,
  kvGbPer1kTokens: 0.15,
  layerCount: 32,
  geometrySource: 'gguf',
};

describe('launch memory meter DOM', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('paints occupancy meters and keeps the spoken launch summary', async () => {
    const { renderLaunchMemoryMeter } = await import('../../src/ui/models/launch-memory-meter.ts');
    const node = renderLaunchMemoryMeter({
      estimate: ESTIMATE,
      hardware: { gpuVramGb: 24, availableRamGb: 31, totalRamGb: 64 },
    });
    document.body.appendChild(node);

    assert.equal(node.classList.contains('models-launch-memory-hint'), true);
    assert.equal(
      node.getAttribute('aria-label'),
      'Estimated memory at launch: ~18.1 GB VRAM + ~1 GB RAM (0.15 GB per 1k ctx)',
    );
    assert.equal(node.querySelector('[data-kind="vram"] .models-launch-memory__value')?.textContent, '18.1 / 24 GB');
    assert.equal(node.querySelector('[data-kind="ram"] .models-launch-memory__value')?.textContent, '1 / 31 GB');
    assert.equal(node.querySelector('.models-launch-memory__note')?.textContent, '0.15 GB per 1k ctx');
    const vramMeter = node.querySelector('[data-kind="vram"] [role="meter"]');
    assert.ok(vramMeter);
    assert.equal(vramMeter?.getAttribute('aria-valuetext'), '18.1 / 24 GB');
  });

  test('does not pretend a percentage when hardware is unknown', async () => {
    const { renderLaunchMemoryMeter } = await import('../../src/ui/models/launch-memory-meter.ts');
    const node = renderLaunchMemoryMeter({ estimate: ESTIMATE, hardware: null });
    assert.equal(node.querySelector('[role="meter"]'), null);
    assert.equal(node.querySelector('[data-kind="vram"] .models-launch-memory__value')?.textContent, '~18.1 GB');
  });
});
