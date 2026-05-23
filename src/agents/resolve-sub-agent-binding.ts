/**
 * Pure sub-agent provider/model resolution (parent chat fallback).
 */

import type { Chat } from '../types';

export interface SubAgentTypeBindingInput {
  providerId: string;
  modelId: string;
}

/** Resolve effective provider + model for a sub-agent type (mirrors orchestrator). */
export function resolveSubAgentModelBinding(
  typeConfig: SubAgentTypeBindingInput,
  parentChat: Chat | undefined,
): { providerId: string; modelId: string } {
  const modelId =
    typeConfig.modelId?.trim() || parentChat?.modelId?.trim() || '';
  const providerId =
    typeConfig.providerId?.trim() ||
    parentChat?.providerId?.trim() ||
    typeConfig.providerId;
  return { providerId, modelId };
}
