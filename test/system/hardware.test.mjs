import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyAmdGfx,
  clearHardwareCacheForTests,
  detectHardware,
  groupGpus,
} from '../../server/system/hardware.js';
import { parseNvidiaSmiGpu } from '../../server/system/vram.js';

describe('parseNvidiaSmiGpu', () => {
  test('parses discrete GPU rows', () => {
    const result = parseNvidiaSmiGpu('24576, NVIDIA GeForce RTX 4090\n12288, NVIDIA GeForce RTX 4090');
    assert.equal(result.available, true);
    if (result.available) {
      assert.equal(result.gpus.length, 2);
      assert.equal(result.gpus[0].name, 'NVIDIA GeForce RTX 4090');
      assert.equal(result.gpus[0].vramGb, 24);
    }
  });

  test('captures unified-memory NVIDIA rows', () => {
    const result = parseNvidiaSmiGpu('[N/A], NVIDIA GB10');
    assert.equal(result.available, false);
    assert.equal(result.unified?.[0]?.name, 'NVIDIA GB10');
  });
});

describe('groupGpus', () => {
  test('groups identical cards and sorts by total VRAM', () => {
    const groups = groupGpus([
      { index: 0, name: 'RTX 4090', vramGb: 24 },
      { index: 1, name: 'RTX 4090', vramGb: 24 },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].vramTotal, 48);
  });
});

describe('classifyAmdGfx', () => {
  test('maps RDNA consumer targets', () => {
    assert.deepEqual(classifyAmdGfx('gfx1200'), { gfx: 'gfx1200', family: 'rdna' });
  });

  test('maps CDNA datacenter targets', () => {
    assert.deepEqual(classifyAmdGfx('gfx942'), { gfx: 'gfx942', family: 'cdna' });
  });
});

describe('detectHardware', () => {
  test('returns CPU/RAM baseline on all platforms', async () => {
    clearHardwareCacheForTests();
    const hw = await detectHardware({ fresh: true });
    assert.ok(hw.cpuCores >= 1);
    assert.ok(hw.totalRamGb > 0);
    assert.ok(hw.detectedAt > 0);
    assert.ok(['cuda', 'rocm', 'metal', 'cpu_x86', 'cpu_arm'].includes(hw.backend));
  });

  test('reports platform matching the host OS', async () => {
    clearHardwareCacheForTests();
    const hw = await detectHardware({ fresh: true });
    if (process.platform === 'win32') {
      assert.equal(hw.os, 'windows');
      assert.equal(hw.platform, 'windows');
    } else if (process.platform === 'darwin') {
      assert.equal(hw.os, 'darwin');
      assert.equal(hw.platform, 'darwin');
    } else {
      assert.equal(hw.os, 'linux');
      assert.equal(hw.platform, 'linux');
    }
  });
});
