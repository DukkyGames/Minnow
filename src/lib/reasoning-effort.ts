/**
 * Reasoning effort resolution for composer controls and completion send path.
 */

import type { ThinkingResolvedMode } from '../agents/thinking-types';
import type { ApiKind } from '../providers/types';
import type { Chat, ModelCapabilities, ReasoningEffortOption } from '../types';

export type { ReasoningEffortOption } from '../types';

/** Canonical ordered list for UI option rendering. */
export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffortOption[] = [
  'off',
  'on',
  'low',
  'medium',
  'high',
] as const;

const EFFORT_SET = new Set<ReasoningEffortOption>(REASONING_EFFORT_OPTIONS);

/** Composer / send options for Qwen3.8 (`xhigh` is mapped to High). */
export const QWEN38_REASONING_OPTIONS: readonly ReasoningEffortOption[] = [
  'off',
  'low',
  'medium',
  'high',
] as const;

/**
 * Qwen3.8 ids (`qwen3.8` / `qwen3_8`) — not Qwen3-8B (`qwen3-8b`).
 * Used for 262K defaults, wire `xhigh`, and `preserve_thinking`.
 */
export function isQwen38ModelId(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return /(?:^|[^a-z0-9])qwen3[._]8(?![0-9])/i.test(modelId);
}

/** Map LM Studio / Qwen `xhigh` onto the composer `high` option; `none` onto Off. */
export function normalizeReasoningCatalogValue(value: unknown): ReasoningEffortOption | undefined {
  if (value === 'xhigh') return 'high';
  if (value === 'none') return 'off';
  return isReasoningEffortOption(value) ? value : undefined;
}

/** Type guard for upstream catalog / session values. */
export function isReasoningEffortOption(value: unknown): value is ReasoningEffortOption {
  return typeof value === 'string' && EFFORT_SET.has(value as ReasoningEffortOption);
}

/** Filter and validate upstream `allowed_options`; preserve canonical order. */
export function normalizeReasoningAllowedOptions(raw: unknown[]): ReasoningEffortOption[] {
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    // Qwen3.8 / LM Studio report `xhigh`; some catalogs use `none` for Off.
    const mapped = value === 'xhigh' ? 'high' : value === 'none' ? 'off' : value;
    seen.add(mapped);
  }
  return REASONING_EFFORT_OPTIONS.filter((option) => seen.has(option));
}

/** True when the header reasoning effort dropdown should be shown. */
export function modelHasSelectableReasoningEffort(
  caps?: ModelCapabilities | null,
): boolean {
  return (caps?.reasoningAllowedOptions?.length ?? 0) >= 2;
}

/** True when allowed options include low / medium / high effort levels. */
export function modelHasReasoningEffortLevels(
  caps?: ModelCapabilities | null,
): boolean {
  const allowed = caps?.reasoningAllowedOptions ?? [];
  return allowed.some((o) => o === 'low' || o === 'medium' || o === 'high');
}

/**
 * Composer shows a level dropdown (not the brain toggle) when effort levels are available.
 */
export function modelUsesComposerReasoningDropdown(
  caps?: ModelCapabilities | null,
): boolean {
  return modelUsesComposerReasoningLevelDropdown(caps);
}

/** Composer shows the brain on/off toggle when model offers off/on without level options. */
export function modelUsesComposerThinkingToggle(
  caps?: ModelCapabilities | null,
): boolean {
  if (modelUsesComposerReasoningDropdown(caps)) return false;
  const allowed = caps?.reasoningAllowedOptions ?? [];
  if (allowed.includes('off') && allowed.includes('on')) return true;
  return allowed.length === 0 && caps?.reasoning !== false;
}

/** True when the composer brain icon should be shown (level dropdown and/or off/on models). */
export function modelShowsComposerBrainToggle(
  caps?: ModelCapabilities | null,
): boolean {
  return modelUsesComposerReasoningDropdown(caps) || modelUsesComposerThinkingToggle(caps);
}

/** Level options for the composer effort dropdown (excludes off/on). */
export function getComposerReasoningLevelOptions(
  allowed: ReasoningEffortOption[],
): ReasoningEffortOption[] {
  return allowed.filter((o) => o === 'low' || o === 'medium' || o === 'high');
}

/** Off/on options for models that use thinking.type instead of reasoning_effort levels. */
export function getComposerReasoningBinaryOptions(
  allowed: ReasoningEffortOption[],
): ReasoningEffortOption[] {
  const normalized = normalizeReasoningAllowedOptions(allowed);
  const options: ReasoningEffortOption[] = [];
  if (normalized.includes('off')) options.push('off');
  if (normalized.includes('on')) options.push('on');
  return options;
}

/** Composer shows low/medium/high select beside the brain toggle. */
export function modelUsesComposerReasoningLevelDropdown(
  caps?: ModelCapabilities | null,
): boolean {
  return modelHasReasoningEffortLevels(caps);
}

/** Binary off/on models use the brain tri-state toggle only (no separate Off/On select). */
export function modelUsesComposerReasoningBinaryDropdown(
  _caps?: ModelCapabilities | null,
): boolean {
  return false;
}

/** Default level when turning reasoning back on from the composer brain toggle. */
export function defaultComposerReasoningLevel(
  caps?: ModelCapabilities | null,
): ReasoningEffortOption | undefined {
  const levels = getComposerReasoningLevelOptions(caps?.reasoningAllowedOptions ?? []);
  if (levels.length === 0) return undefined;
  const catalogDefault = caps?.reasoningDefault;
  if (catalogDefault && levels.includes(catalogDefault)) return catalogDefault;
  if (levels.includes('medium')) return 'medium';
  return levels[0];
}

/** Human-readable label for composer `<select>` options. */
export function formatReasoningEffortLabel(option: ReasoningEffortOption): string {
  switch (option) {
    case 'off':
      return 'Off';
    case 'on':
      return 'On';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    default:
      return option;
  }
}

/** Models on openai-v1 that only support thinking.type on/off, not reasoning_effort levels. */
function isThinkingTypeOnlyOpenAiModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return /kimi|moonshot|deepseek|minimax/.test(id);
}

/**
 * Fallback allowed options when catalog lacks reasoning metadata.
 * Qwen3.8 always gets levels (any provider). Other models only infer on openai-v1.
 *
 * Bare `{ id }` catalogs (llama.cpp, mlx_lm.server, MTPLX) carry no reasoning block,
 * so this is the *only* signal for every model they serve. Levels stay the default
 * here deliberately: narrowing it to an id allowlist of effort-trained families hid
 * the dropdown on MTPLX models whose ids the list did not anticipate, and hiding a
 * control the model can use is a worse failure than showing one it ignores. An
 * effort the model was not trained on is inert, not harmful. A catalog
 * `allowed_options` block always wins over this inference.
 */
export function inferReasoningOptionsFromModelId(
  modelId: string,
  apiKind?: ApiKind,
): ReasoningEffortOption[] {
  // Qwen3.8 exposes off/low/medium/high on every provider; default effort is high (wire xhigh).
  if (isQwen38ModelId(modelId)) {
    return [...QWEN38_REASONING_OPTIONS];
  }
  if (apiKind !== 'openai-v1') return [];
  if (isThinkingTypeOnlyOpenAiModel(modelId)) {
    return ['off', 'on'];
  }
  return ['off', 'low', 'medium', 'high'];
}

/**
 * Qwen3.8 always offers Low/Medium/High even when LM Studio advertises off/on
 * or My Models rows have no catalog reasoning block.
 */
export function ensureQwen38ReasoningAllowedOptions(
  modelId: string | null | undefined,
  allowed: ReasoningEffortOption[],
): ReasoningEffortOption[] {
  if (!isQwen38ModelId(modelId)) return allowed;
  const hasLevels = allowed.some((o) => o === 'low' || o === 'medium' || o === 'high');
  if (hasLevels) {
    return normalizeReasoningAllowedOptions([...allowed, ...QWEN38_REASONING_OPTIONS]);
  }
  return [...QWEN38_REASONING_OPTIONS];
}

/**
 * Merge chat override, inherited thinking mode, catalog default, and fallbacks into one effort.
 * Resolution order: chat override → inherited on → catalog default → inherited off → first allowed.
 */
export function resolveEffectiveReasoningEffort(
  chat: Pick<Chat, 'reasoningEffort'>,
  caps: ModelCapabilities | null | undefined,
  inheritedResolved: ThinkingResolvedMode,
): ReasoningEffortOption | undefined {
  const allowed = caps?.reasoningAllowedOptions ?? [];
  if (allowed.length === 0) return undefined;

  // Honor explicit off from the composer brain even when catalog omits `off`.
  if (chat.reasoningEffort === 'off') {
    return 'off';
  }

  if (chat.reasoningEffort && allowed.includes(chat.reasoningEffort)) {
    return chat.reasoningEffort;
  }

  // Inherited thinking on must win over catalog defaults such as `off` on some models.
  if (inheritedResolved === 'on') {
    const catalogDefault = caps?.reasoningDefault;
    // Prefer a non-off catalog default (Qwen3.8 → high) over a hardcoded medium.
    if (catalogDefault && catalogDefault !== 'off' && allowed.includes(catalogDefault)) {
      return catalogDefault;
    }
    if (allowed.includes('medium')) return 'medium';
    if (allowed.includes('on')) return 'on';
  }

  const catalogDefault = caps?.reasoningDefault;
  if (catalogDefault && allowed.includes(catalogDefault)) {
    return catalogDefault;
  }

  if (inheritedResolved === 'off' && allowed.includes('off')) {
    return 'off';
  }

  return allowed[0];
}
