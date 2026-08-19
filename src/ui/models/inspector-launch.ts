/**
 * Inspector launch-draft helpers.
 *
 * Empty draft → Load sends `{}` and the server planner owns ctx / ngl / cache.
 * First touch of context, GPU layers, or KV cache copies the displayed plan and
 * sets `fit_mode: 'manual'`. Pass-through fields (batch, parallel, extra_args, env)
 * can exist without leaving auto.
 */

import type { LlamaServeSettings } from '../../models/api-client';
import {
  CONTEXT_LADDER,
  planLlamaLaunch,
  type LaunchHardware,
  type LlamaLaunchPlan,
} from '../../models/launch-plan.mjs';
import { geometryFromGgufMetadata, resolveGeometry } from '../../models/model-geometry.mjs';
import type { GgufGeometryFacts } from '../../models/serve-memory-estimate';
import type { HardwareSnapshot } from '../../models/types';

const LADDER_MAX = CONTEXT_LADDER[CONTEXT_LADDER.length - 1];

/** Inspector slider floor. Same as the planner's lowest rung. */
export const CONTEXT_SLIDER_MIN = CONTEXT_LADDER[0];

/**
 * Manual context slider step in tokens. Auto-planning still snaps to CONTEXT_LADDER;
 * the Load-tab range uses 1k so a 262k ceiling is pointer-fine instead of 13 jumps.
 */
export const CONTEXT_SLIDER_STEP = 1024;

/** Values the Load tab shows before the user overrides them. */
export interface DisplayedLaunch {
  ctxPerSlot: number;
  /** Total `-c` (`ctxPerSlot * parallel`). */
  ctx: number;
  /** `null` means GPU auto — llama.cpp sizes the split. `0` is CPU. */
  n_gpu_layers: number | null;
  cache_type: string;
  parallel: number;
  trainCtx: number | null;
  plan: LlamaLaunchPlan;
}

/**
 * Slider ceiling: trained context when the header has it, else the last ladder rung,
 * never above 262144.
 */
export function contextSliderMax(trainCtx?: number | null): number {
  const trained = Number(trainCtx) > 0 ? Math.trunc(Number(trainCtx)) : LADDER_MAX;
  return Math.min(trained, LADDER_MAX);
}

/**
 * Snap a per-slot context onto the inspector slider grid.
 * Floors to CONTEXT_SLIDER_STEP, never below the floor, never above `maxTokens`.
 * The slider max itself is always legal so a non-aligned trainCtx (e.g. 10000) can
 * still be chosen at the far right.
 */
export function snapCtxPerSlot(tokens: number, maxTokens: number): number {
  const max = Math.max(1, Math.trunc(Number(maxTokens) || 0));
  const min = Math.min(CONTEXT_SLIDER_MIN, max);
  if (!Number.isFinite(tokens)) return min;
  if (tokens <= min) return min;
  if (tokens >= max) return max;
  const stepped =
    min + Math.floor((tokens - min) / CONTEXT_SLIDER_STEP) * CONTEXT_SLIDER_STEP;
  return Math.min(max, Math.max(min, stepped));
}

/**
 * Payload for `loadModel`. Empty / auto drafts omit ctx / ngl / cache so the server
 * cannot mistake a 125k/999 materialization for a user choice.
 */
export function settingsForDraft(draft: LlamaServeSettings | undefined): LlamaServeSettings {
  if (!draft) return {};
  if (draft.fit_mode !== 'manual') {
    const out: LlamaServeSettings = {};
    if (draft.batch_size != null) out.batch_size = draft.batch_size;
    if (draft.ubatch_size != null) out.ubatch_size = draft.ubatch_size;
    if (draft.parallel != null) out.parallel = draft.parallel;
    if (draft.extra_args) out.extra_args = draft.extra_args;
    if (draft.env) out.env = draft.env;
    if (draft.split_mode) out.split_mode = draft.split_mode;
    if (draft.tensor_split) out.tensor_split = draft.tensor_split;
    if (draft.main_gpu != null) out.main_gpu = draft.main_gpu;
    if (draft.n_cpu_moe != null) out.n_cpu_moe = draft.n_cpu_moe;
    if (draft.no_mmap === true) out.no_mmap = true;
    if (draft.mlock === true) out.mlock = true;
    if (draft.chat_template) out.chat_template = draft.chat_template;
    if (draft.chat_template_file) out.chat_template_file = draft.chat_template_file;
    return out;
  }
  return { ...draft };
}

function passThroughFrom(draft: LlamaServeSettings | undefined): LlamaServeSettings {
  return settingsForDraft(
    draft?.fit_mode === 'manual' ? { ...draft, fit_mode: 'auto' } : draft,
  );
}

/**
 * Copy the currently displayed (planned) values and mark the draft manual.
 * Subsequent touches mutate the existing manual draft.
 */
export function ensureManualDraft(
  draft: LlamaServeSettings | undefined,
  displayed: DisplayedLaunch,
): LlamaServeSettings {
  if (draft?.fit_mode === 'manual') return { ...draft };
  const parallel = Math.max(1, draft?.parallel ?? displayed.parallel);
  const next: LlamaServeSettings = {
    ...passThroughFrom(draft),
    fit_mode: 'manual',
    ctx: displayed.ctx,
    cache_type: displayed.cache_type,
    parallel,
  };
  if (displayed.n_gpu_layers != null) next.n_gpu_layers = displayed.n_gpu_layers;
  return next;
}

/** First (or later) touch of the per-slot context slider. Stores total `-c`. */
export function applyCtxPerSlotTouch(
  draft: LlamaServeSettings | undefined,
  displayed: DisplayedLaunch,
  ctxPerSlot: number,
): LlamaServeSettings {
  const next = ensureManualDraft(draft, displayed);
  const parallel = Math.max(1, next.parallel ?? displayed.parallel);
  next.ctx = ctxPerSlot * parallel;
  next.parallel = parallel;
  return next;
}

/** First (or later) touch of GPU layers. Moving the slider writes a count, never Auto. */
export function applyGpuLayersTouch(
  draft: LlamaServeSettings | undefined,
  displayed: DisplayedLaunch,
  nGpuLayers: number,
): LlamaServeSettings {
  const next = ensureManualDraft(draft, displayed);
  next.n_gpu_layers = nGpuLayers;
  return next;
}

/**
 * Restore GPU Auto: drop `n_gpu_layers` so llama.cpp `--fit` owns the split.
 * Custom context / KV stay manual. If those still match the plan (the first GPU
 * tick copies them), fall back to planner auto and keep pass-through fields.
 */
export function applyGpuLayersAuto(
  draft: LlamaServeSettings | undefined,
  displayed: DisplayedLaunch,
): LlamaServeSettings {
  const next: LlamaServeSettings = { ...(draft ?? {}) };
  delete next.n_gpu_layers;

  if (next.fit_mode !== 'manual') {
    return passThroughFrom(next);
  }

  const ctxMatchesPlan = next.ctx == null || next.ctx === displayed.plan.ctx;
  const cacheMatchesPlan = !next.cache_type || next.cache_type === displayed.plan.cache_type;
  if (ctxMatchesPlan && cacheMatchesPlan) {
    const restored = passThroughFrom({ ...next, fit_mode: 'auto' });
    // ensureManualDraft always copies parallel; 1 is the default, not an override.
    if (restored.parallel === 1) delete restored.parallel;
    return restored;
  }

  return next;
}

export function applyCacheTypeTouch(
  draft: LlamaServeSettings | undefined,
  displayed: DisplayedLaunch,
  cacheType: string,
): LlamaServeSettings {
  const next = ensureManualDraft(draft, displayed);
  next.cache_type = cacheType;
  return next;
}

/**
 * Parallel / batch / extra_args do not leave auto. When already manual, keep per-slot
 * context and rescale total `-c`.
 */
export function applyPassThroughTouch(
  draft: LlamaServeSettings | undefined,
  displayed: DisplayedLaunch,
  patch: LlamaServeSettings,
): LlamaServeSettings {
  if (draft?.fit_mode === 'manual' && patch.parallel != null) {
    const prevParallel = Math.max(1, draft.parallel ?? displayed.parallel);
    const perSlot = Math.max(1, Math.round((draft.ctx ?? displayed.ctx) / prevParallel));
    return {
      ...draft,
      ...patch,
      parallel: patch.parallel,
      ctx: perSlot * Math.max(1, patch.parallel),
    };
  }
  if (draft?.fit_mode === 'manual') return { ...draft, ...patch };
  return { ...passThroughFrom(draft), ...patch };
}

export function isManualDraft(draft: LlamaServeSettings | undefined): boolean {
  return draft?.fit_mode === 'manual';
}

/**
 * Client-side plan for slider starting positions. Same function the server runs.
 *
 * `variant` should be the installed llama.cpp id (`cuda-12.4`, …) when
 * `fetchLlamaRuntime()` has returned — that decides `--flash-attn on` vs `auto`.
 * `hardware.backend` is the fallback before that GET lands (probe, not install).
 */
export function inspectorLaunchPlan(input: {
  gguf: GgufGeometryFacts | null;
  arch?: string | null;
  name?: string | null;
  paramsB?: number | null;
  sizeBytes: number;
  hardware: HardwareSnapshot | null;
  variant?: string | null;
  parallel?: number;
}): LlamaLaunchPlan {
  const geometry =
    (input.gguf ? geometryFromGgufMetadata(input.gguf) : null) ??
    resolveGeometry({
      architecture: input.arch ?? undefined,
      name: input.name ?? undefined,
      paramsB: input.paramsB ?? undefined,
    });
  const variant = input.variant || input.hardware?.backend || 'cpu';
  const hw = input.hardware;
  const hardware: LaunchHardware = {
    gpuVramGb: hw?.gpuVramGb,
    availableRamGb: hw?.availableRamGb,
    totalRamGb: hw?.totalRamGb,
    backend: hw?.backend,
  };
  const trainCtx = Number(input.gguf?.trainCtx) > 0 ? Number(input.gguf?.trainCtx) : undefined;
  const weightsBytes = Math.max(0, input.sizeBytes || 0);
  const parallel = Math.max(1, Math.trunc(Number(input.parallel) || 1));

  return planLlamaLaunch({
    geometry,
    weightsBytes,
    trainCtx,
    hardware,
    variant,
    parallel,
  });
}

/** Merge a draft (or the empty auto state) with the client plan for rendering. */
export function displayedLaunchFrom(
  draft: LlamaServeSettings | undefined,
  plan: LlamaLaunchPlan,
  trainCtx: number | null,
): DisplayedLaunch {
  const parallel = Math.max(1, draft?.parallel ?? 1);
  if (draft?.fit_mode !== 'manual') {
    return {
      ctxPerSlot: plan.ctxPerSlot,
      ctx: plan.ctx,
      n_gpu_layers: plan.n_gpu_layers,
      cache_type: plan.cache_type,
      parallel,
      trainCtx,
      plan,
    };
  }
  const perSlot = snapCtxPerSlot(
    Math.round((Number(draft.ctx) || plan.ctx) / Math.max(1, draft.parallel ?? parallel)),
    contextSliderMax(trainCtx),
  );
  return {
    ctxPerSlot: perSlot,
    ctx: perSlot * Math.max(1, draft.parallel ?? parallel),
    n_gpu_layers: draft.n_gpu_layers ?? null,
    cache_type: draft.cache_type ?? plan.cache_type,
    parallel: Math.max(1, draft.parallel ?? parallel),
    trainCtx,
    plan,
  };
}
