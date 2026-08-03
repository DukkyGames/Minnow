/**
 * Gating helpers for thinking mode UI based on model capabilities.
 */

import type { ModelCapabilities } from '../types';
import type { ThinkingResolvedMode, ThinkingTriState } from './thinking-types';

/** Whether the effective model may expose reasoning streams (best-effort when unknown). */
export function modelSupportsThinkingControl(
  capabilities?: ModelCapabilities | null,
): boolean {
  if (!capabilities) return true;
  if (capabilities.reasoningAllowedOptions?.length) return true;
  if (capabilities.reasoning === true) return true;
  if (capabilities.reasoning === false) return false;
  return true;
}

/** Whether a target resolved mode is allowed for the model catalog/probe matrix. */
export function modelAllowsThinkingMode(
  capabilities: ModelCapabilities | null | undefined,
  target: ThinkingResolvedMode,
): boolean {
  const allowed = capabilities?.reasoningAllowedOptions;
  if (allowed?.length) return allowed.includes(target);
  if (capabilities?.reasoning === false && target === 'on') return false;
  return true;
}

export function formatThinkingInheritedLabel(
  triState: ThinkingTriState,
  resolved: ThinkingResolvedMode,
  sourceLabel: string,
): string {
  if (triState !== 'inherit') return '';
  const modeLabel = resolved === 'on' ? 'Reasoning on' : 'Reasoning off';
  return `Inherited · ${modeLabel} (${sourceLabel})`;
}
