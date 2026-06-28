/**
 * Reasoning effort resolution for header dropdown and completion send path.
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

/** Type guard for upstream catalog / session values. */
export function isReasoningEffortOption(value: unknown): value is ReasoningEffortOption {
  return typeof value === 'string' && EFFORT_SET.has(value as ReasoningEffortOption);
}

/** Filter and validate upstream `allowed_options`; preserve canonical order. */
export function normalizeReasoningAllowedOptions(raw: unknown[]): ReasoningEffortOption[] {
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value === 'string') seen.add(value);
  }
  return REASONING_EFFORT_OPTIONS.filter((option) => seen.has(option));
}

/** True when the header reasoning effort dropdown should be shown. */
export function modelHasSelectableReasoningEffort(
  caps?: ModelCapabilities | null,
): boolean {
  return (caps?.reasoningAllowedOptions?.length ?? 0) >= 2;
}

/** Human-readable label for header `<select>` options. */
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
 * Fallback allowed options for openai-v1 providers when catalog lacks reasoning metadata.
 * All models on the OpenAI-compatible API get selectable effort; thinking-only vendors use off/on.
 */
export function inferReasoningOptionsFromModelId(
  modelId: string,
  apiKind: ApiKind,
): ReasoningEffortOption[] {
  if (apiKind !== 'openai-v1') return [];
  if (isThinkingTypeOnlyOpenAiModel(modelId)) {
    return ['off', 'on'];
  }
  return ['off', 'low', 'medium', 'high'];
}

/**
 * Merge chat override, catalog default, and brain-toggle resolution into one effort.
 * Resolution order: chat override → catalog default → brain toggle map → first allowed.
 */
export function resolveEffectiveReasoningEffort(
  chat: Pick<Chat, 'reasoningEffort'>,
  caps: ModelCapabilities | null | undefined,
  inheritedResolved: ThinkingResolvedMode,
): ReasoningEffortOption | undefined {
  const allowed = caps?.reasoningAllowedOptions ?? [];
  if (allowed.length === 0) return undefined;

  if (chat.reasoningEffort && allowed.includes(chat.reasoningEffort)) {
    return chat.reasoningEffort;
  }

  const catalogDefault = caps?.reasoningDefault;
  if (catalogDefault && allowed.includes(catalogDefault)) {
    return catalogDefault;
  }

  if (inheritedResolved === 'on') {
    if (allowed.includes('medium')) return 'medium';
    if (allowed.includes('on')) return 'on';
  } else if (allowed.includes('off')) {
    return 'off';
  }

  return allowed[0];
}
