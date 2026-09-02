/**
 * Headless `minnow run` must honor Settings → Sampler, not a 4096/2048 cap.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  resetSamplerMetaCache,
  setSamplerMetaForTests,
} from '../../src/config/sampler-meta.ts';
import { resolveHeadlessTurnSampler } from '../../src/headless/resolve-turn-sampler.ts';
import { resetWorkAgentRegistry } from '../../src/agents/work-agent-registry.ts';

describe('headless turn sampler', () => {
  afterEach(() => {
    resetSamplerMetaCache();
    resetWorkAgentRegistry();
  });

  test('uses Settings sampler max tokens, not the old 4096 hard cap', () => {
    setSamplerMetaForTests({ temperature: 1, maxTokens: 131072 });
    const resolved = resolveHeadlessTurnSampler(null);
    assert.equal(resolved.maxTokens, 131072);
    assert.ok(resolved.preset);
  });
});
