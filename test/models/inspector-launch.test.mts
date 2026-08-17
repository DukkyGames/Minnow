/**
 * Inspector launch-draft helpers (Phase 1c).
 *
 * Load must send `{}` until a ctx / GPU / KV control is touched so the server
 * planner owns those fields. Hardcoded display fixtures — do not call
 * planLlamaLaunch here; that module already has its own golden tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CONTEXT_LADDER, type LlamaLaunchPlan } from '../../src/models/launch-plan.mjs';
import { llamaSettingsFromLaunchPrefs, estimateLoadDurationMs } from '../../src/config/library-launch-meta.ts';
import {
  contextSliderMax,
  ensureManualDraft,
  settingsForDraft,
  snapCtxPerSlot,
  type DisplayedLaunch,
} from '../../src/ui/models/inspector-launch.ts';

/** Static auto-mode display (12 GB CUDA 8B at preferred 32k). */
const PLAN: LlamaLaunchPlan = {
  ctx: 32768,
  ctxPerSlot: 32768,
  n_gpu_layers: null,
  cache_type: 'f16',
  flash_attn: 'on',
  fits: true,
  estimateGb: 8,
  reason: 'fixture',
  clampedFrom: null,
};

const DISPLAYED: DisplayedLaunch = {
  ctxPerSlot: 32768,
  ctx: 32768,
  n_gpu_layers: null,
  cache_type: 'f16',
  parallel: 1,
  trainCtx: 131072,
  plan: PLAN,
};

describe('inspector-launch draft helpers', () => {
  it('settingsForDraft(undefined) is {} so Load does not materialize 125k/999', () => {
    assert.deepEqual(settingsForDraft(undefined), {});
  });

  it('auto draft with only parallel still omits ctx and n_gpu_layers', () => {
    const payload = settingsForDraft({ parallel: 4 });
    assert.deepEqual(payload, { parallel: 4 });
    assert.equal(payload.ctx, undefined);
    assert.equal(payload.n_gpu_layers, undefined);
    assert.equal(payload.fit_mode, undefined);
    assert.equal(payload.cache_type, undefined);
  });

  it('ensureManualDraft sets fit_mode manual and copies the displayed ctx', () => {
    const next = ensureManualDraft(undefined, DISPLAYED);
    assert.equal(next.fit_mode, 'manual');
    assert.equal(next.ctx, DISPLAYED.ctx);
    assert.equal(next.cache_type, DISPLAYED.cache_type);
    assert.equal(next.parallel, DISPLAYED.parallel);
    // GPU auto is null — do not write n_gpu_layers so the server keeps --fit on
    // until the user actually moves the layers slider.
    assert.equal(next.n_gpu_layers, undefined);
  });

  it('estimateLoadDurationMs scales monotonically with file size', () => {
    assert.equal(estimateLoadDurationMs(2_000_000_000, 10_000, 1_000_000_000), 20_000);
    assert.equal(estimateLoadDurationMs(1_000_000_000, 10_000, 1_000_000_000), 10_000);
    assert.equal(estimateLoadDurationMs(0, 10_000, 1_000_000_000), null);
  });

  it('saved manual launch prefs round-trip through settingsForDraft', () => {
    const saved = {
      fit_mode: 'manual' as const,
      ctx: 8192,
      n_gpu_layers: 12,
      cache_type: 'q8_0',
      parallel: 2,
      lastLoadMs: 5000,
      lastWeightsBytes: 1_000_000_000,
    };
    const draft = llamaSettingsFromLaunchPrefs(saved);
    assert.ok(draft);
    assert.equal((draft as { lastLoadMs?: number }).lastLoadMs, undefined);
    assert.deepEqual(settingsForDraft(draft), {
      fit_mode: 'manual',
      ctx: 8192,
      n_gpu_layers: 12,
      cache_type: 'q8_0',
      parallel: 2,
    });
  });

  it('snapCtxPerSlot and contextSliderMax never exceed trainCtx', () => {
    assert.equal(contextSliderMax(8192), 8192);
    assert.equal(contextSliderMax(131072), 131072);
    // Missing header → last ladder rung, not an unbounded slider.
    assert.equal(contextSliderMax(null), CONTEXT_LADDER[CONTEXT_LADDER.length - 1]);
    assert.equal(contextSliderMax(undefined), CONTEXT_LADDER[CONTEXT_LADDER.length - 1]);
    // 20k requested but trained context is 8k → snap to 8192, not 16384.
    assert.equal(snapCtxPerSlot(20000, 8192), 8192);
    // 5k under an 8k cap → next ladder rung down (4096).
    assert.equal(snapCtxPerSlot(5000, 8192), 4096);
    assert.equal(snapCtxPerSlot(32768, 131072), 32768);
  });
});
