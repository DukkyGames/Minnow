import type { ModelCapabilities } from '../types';
import type { ThinkingResolvedMode, ThinkingTriState } from './thinking-types';

export function modelSupportsThinkingControl(
  capabilities?: ModelCapabilities | null,
): boolean {
  if (!capabilities) return true;
  if (capabilities.reasoningAllowedOptions?.length) return true;
  if (capabilities.reasoning === true) return true;
  if (capabilities.reasoning === false) return false;
  return true;
}

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
