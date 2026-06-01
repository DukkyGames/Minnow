/**
 * Per-agent sampler presets (temperature, nucleus, penalties) for completion bodies.
 */

/** Partial preset; omitted keys inherit from lower merge layers. */
export interface SamplerPreset {
  temperature?: number;
  /** Nucleus sampling; 1 = effectively off. */
  topP?: number;
  /** Top-k cap; omitted when unset (not sent upstream). */
  topK?: number;
  /** Min-p threshold; omitted when unset. */
  minP?: number;
  /** Repeat penalty; 1 = no penalty. */
  repetitionPenalty?: number;
  /**
   * Presence penalty (0–2); 0 = no penalty. Qwen's recommended knob for curbing
   * endless repetitions in non-thinking/instruct mode (~1.5). Omitted when unset.
   */
  presencePenalty?: number;
  /** Sub-agent output cap when set on type defaults or user override. */
  maxTokens?: number;
}

/** OpenAI-compatible sampler fields merged into a completion body. */
export interface SamplerCompletionFields {
  temperature: number;
  max_tokens: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
}

const TEMP_MIN = 0;
const TEMP_MAX = 2;
const TOP_P_MIN = 0;
const TOP_P_MAX = 1;
const MIN_P_MIN = 0;
const MIN_P_MAX = 1;
const REP_MIN = 1;
const REP_MAX = 2;
const PRESENCE_MIN = 0;
const PRESENCE_MAX = 2;
const TOP_K_MIN = 1;
const TOP_K_MAX = 200;
const MAX_TOKENS_MIN = 1;
const MAX_TOKENS_MAX = 131072;

/** Field-level merge: later layers override earlier keys when defined. */
export function mergeSamplerLayers(
  ...layers: Array<SamplerPreset | null | undefined>
): SamplerPreset {
  const out: SamplerPreset = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.temperature !== undefined) out.temperature = layer.temperature;
    if (layer.topP !== undefined) out.topP = layer.topP;
    if (layer.topK !== undefined) out.topK = layer.topK;
    if (layer.minP !== undefined) out.minP = layer.minP;
    if (layer.repetitionPenalty !== undefined) {
      out.repetitionPenalty = layer.repetitionPenalty;
    }
    if (layer.presencePenalty !== undefined) {
      out.presencePenalty = layer.presencePenalty;
    }
    if (layer.maxTokens !== undefined) out.maxTokens = layer.maxTokens;
  }
  return out;
}

function clampTemperature(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(TEMP_MAX, Math.max(TEMP_MIN, n));
}

function clampTopP(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(TOP_P_MAX, Math.max(TOP_P_MIN, n));
}

function clampTopK(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < TOP_K_MIN) return undefined;
  return Math.min(TOP_K_MAX, Math.floor(n));
}

function clampMinP(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(MIN_P_MAX, Math.max(MIN_P_MIN, n));
}

function clampRepetitionPenalty(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < REP_MIN) return undefined;
  return Math.min(REP_MAX, n);
}

function clampPresencePenalty(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < PRESENCE_MIN) return undefined;
  return Math.min(PRESENCE_MAX, n);
}

function clampMaxTokens(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < MAX_TOKENS_MIN) return undefined;
  return Math.min(MAX_TOKENS_MAX, Math.floor(n));
}

/** Normalize and clamp a partial preset (strips invalid fields). */
export function clampSamplerPreset(raw: SamplerPreset | null | undefined): SamplerPreset {
  if (!raw || typeof raw !== 'object') return {};
  const out: SamplerPreset = {};
  const temperature = clampTemperature(raw.temperature);
  if (temperature !== undefined) out.temperature = temperature;
  const topP = clampTopP(raw.topP);
  if (topP !== undefined) out.topP = topP;
  const topK = clampTopK(raw.topK);
  if (topK !== undefined) out.topK = topK;
  const minP = clampMinP(raw.minP);
  if (minP !== undefined) out.minP = minP;
  const repetitionPenalty = clampRepetitionPenalty(raw.repetitionPenalty);
  if (repetitionPenalty !== undefined) out.repetitionPenalty = repetitionPenalty;
  const presencePenalty = clampPresencePenalty(raw.presencePenalty);
  if (presencePenalty !== undefined) out.presencePenalty = presencePenalty;
  const maxTokens = clampMaxTokens(raw.maxTokens);
  if (maxTokens !== undefined) out.maxTokens = maxTokens;
  return out;
}

/** Map internal preset to outbound completion JSON keys (omit unset fields). */
export function samplerToCompletionFields(
  preset: SamplerPreset,
  maxTokens: number,
): SamplerCompletionFields {
  const temperature =
    preset.temperature !== undefined && Number.isFinite(preset.temperature)
      ? preset.temperature
      : 0.7;
  const fields: SamplerCompletionFields = {
    temperature,
    max_tokens: maxTokens,
  };
  if (preset.topP !== undefined) fields.top_p = preset.topP;
  if (preset.topK !== undefined) fields.top_k = preset.topK;
  if (preset.minP !== undefined) fields.min_p = preset.minP;
  if (preset.repetitionPenalty !== undefined) {
    fields.repetition_penalty = preset.repetitionPenalty;
  }
  if (preset.presencePenalty !== undefined) {
    fields.presence_penalty = preset.presencePenalty;
  }
  return fields;
}

/** Apply sampler fields onto an existing completion body object. */
export function applySamplerToBody<T extends Record<string, unknown>>(
  body: T,
  preset: SamplerPreset,
  maxTokens: number,
): T & SamplerCompletionFields {
  const mapped = samplerToCompletionFields(preset, maxTokens);
  return { ...body, ...mapped };
}
