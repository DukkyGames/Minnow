import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeSamplerPreset } from '../../server/agents/sampler.js';
import { normalizeSubAgentsConfig } from '../../server/config/validators.js';

describe('server sampler normalization', () => {
  test('normalizeSamplerPreset clamps temperature', () => {
    const out = normalizeSamplerPreset({ temperature: 5, topP: 0.5 });
    assert.equal(out.temperature, 2);
    assert.equal(out.topP, 0.5);
  });

  test('normalizeSubAgentsConfig clamps checkInNudgeMs', () => {
    const { config: zero } = normalizeSubAgentsConfig({ checkInNudgeMs: 0 });
    assert.equal(zero.checkInNudgeMs, 0);
    const { config: high } = normalizeSubAgentsConfig({ checkInNudgeMs: 9_999_999 });
    assert.equal(high.checkInNudgeMs, 1_800_000);
    const { config: def } = normalizeSubAgentsConfig({});
    assert.equal(def.checkInNudgeMs, 120_000);
  });

  test('normalizeSubAgentsConfig clamps types.*.sampler', () => {
    const { config } = normalizeSubAgentsConfig({
      types: {
        explore: {
          sampler: { temperature: 3, topK: 80 },
        },
      },
    });
    assert.equal(config.types.explore.sampler.temperature, 2);
    assert.equal(config.types.explore.sampler.topK, 80);
  });
});
