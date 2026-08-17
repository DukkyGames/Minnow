/**
 * Session-scoped llama.cpp launch drafts for My Models.
 *
 * The inspector Load tab is the editor; every GGUF load path (inspector footer,
 * library row Load, picker auto-load) must read the same map. Drafts used to
 * live only in the inspector module, so row/picker loads spawned llama-server
 * at DEFAULT_CONTEXT_TOKENS (125k) while the slider showed a different value.
 */

import { DEFAULT_CONTEXT_TOKENS } from './default-context-tokens';
import type { LlamaServeSettings } from './api-client';
import type { LibraryModel } from './library';

/** Floor of the inspector context slider — also the smallest -c we offer. */
export const CONTEXT_SLIDER_MIN = 2_048;
/** Ceiling when the GGUF header has not given us a tighter trainCtx. */
export const CONTEXT_SLIDER_MAX = 262_144;
/**
 * HTML range requires value = min + n×step. A 1000-token step with min 2048
 * cannot represent 125000, so the browser may snap the thumb (sometimes to min).
 * Step 1 keeps 2048 and the 125k default both valid.
 */
export const CONTEXT_SLIDER_STEP = 1;

const drafts = new Map<string, LlamaServeSettings>();

/** Default argv the inspector shows before the user touches a control. */
export function defaultLaunchSettings(): LlamaServeSettings {
  return { ctx: DEFAULT_CONTEXT_TOKENS, n_gpu_layers: 999, cache_type: 'f16' };
}

/**
 * Snap a token count onto the slider grid and into [min, max].
 * `max` is usually trainCtx when the catalog/header knows it.
 */
export function clampContextSlider(
  tokens: number,
  max: number = CONTEXT_SLIDER_MAX,
): number {
  if (!Number.isFinite(tokens)) return CONTEXT_SLIDER_MIN;
  const ceiling = Math.max(CONTEXT_SLIDER_MIN, max);
  const stepped = Math.round(tokens / CONTEXT_SLIDER_STEP) * CONTEXT_SLIDER_STEP;
  return Math.min(ceiling, Math.max(CONTEXT_SLIDER_MIN, stepped));
}

/** True when `value` is a legal HTML range value for the context slider. */
export function contextSliderValueIsValid(
  value: number,
  max: number = CONTEXT_SLIDER_MAX,
): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < CONTEXT_SLIDER_MIN || value > max) return false;
  return (value - CONTEXT_SLIDER_MIN) % CONTEXT_SLIDER_STEP === 0;
}

/** Slider max: never above the model's trained window when we know it. */
export function contextSliderMax(trainCtx: number | null | undefined): number {
  if (typeof trainCtx === 'number' && trainCtx >= CONTEXT_SLIDER_MIN) {
    return Math.min(CONTEXT_SLIDER_MAX, trainCtx);
  }
  return CONTEXT_SLIDER_MAX;
}

/** Get or create the in-session launch draft for a library row. */
export function getLaunchSettings(modelId: string): LlamaServeSettings {
  const id = modelId.trim();
  let draft = drafts.get(id);
  if (!draft) {
    draft = defaultLaunchSettings();
    drafts.set(id, draft);
  }
  if (!draft.cache_type) draft.cache_type = 'f16';
  return draft;
}

/** Merge a patch into the draft and return the same object the inspector holds. */
export function patchLaunchSettings(
  modelId: string,
  patch: Partial<LlamaServeSettings>,
): LlamaServeSettings {
  const draft = getLaunchSettings(modelId);
  Object.assign(draft, patch);
  return draft;
}

/**
 * Settings actually sent to POST /api/models/serve.
 * Ollama and MLX ignore llama.cpp argv; GGUF uses the explicit override or the draft.
 */
export function resolveLlamaServeSettings(
  model: Pick<LibraryModel, 'id' | 'source' | 'format'>,
  explicit?: LlamaServeSettings,
): LlamaServeSettings | undefined {
  if (model.source === 'ollama' || model.format === 'MLX') return undefined;
  return explicit ?? getLaunchSettings(model.id);
}

/** Test hook — production code must not clear drafts mid-session. */
export function clearLaunchSettingsForTests(): void {
  drafts.clear();
}
