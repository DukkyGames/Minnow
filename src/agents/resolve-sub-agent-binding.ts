import type { Chat } from '../types';

export interface SubAgentTypeBindingInput {
  providerId: string;
  modelId: string;
}

export interface SubAgentBindingDefaults {
  providerId: string;
  modelId: string;
}

export function resolveSubAgentModelBinding(
  typeConfig: SubAgentTypeBindingInput,
  parentChat: Chat | undefined,
  globalDefaults?: SubAgentBindingDefaults,
): { providerId: string; modelId: string } {
  let providerId = typeConfig.providerId?.trim() ?? '';
  let modelId = typeConfig.modelId?.trim() ?? '';

  if (!providerId) {
    providerId =
      parentChat?.providerId?.trim() ||
      globalDefaults?.providerId?.trim() ||
      '';
  }
  if (!modelId) {
    modelId =
      parentChat?.modelId?.trim() ||
      globalDefaults?.modelId?.trim() ||
      '';
  }

  return { providerId, modelId };
}
