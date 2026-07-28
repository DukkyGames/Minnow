/**
 * Resolve provider/model for an orchestrate board (planner + task chats).
 */

import { getAutopilotMetaSync } from '../../config/autopilot-meta.ts';
import { isDomAvailable } from '../../lib/dom-available.ts';
import { decodeModelSelectKey } from '../../lib/model-select-key.ts';
import type { Chat, OrchestrateBoardState } from '../../types.ts';

/** Board override → planner chat → top-bar picker → autopilot default planner model. */
export function resolveBoardModelBinding(
  plannerChat: Chat,
  board?: OrchestrateBoardState | null,
): { providerId: string; modelId: string } {
  const boardModelId = board?.modelId?.trim() ?? '';
  if (boardModelId) {
    return {
      providerId:
        board?.modelProviderId?.trim() ||
        plannerChat.providerId?.trim() ||
        '',
      modelId: boardModelId,
    };
  }

  let providerId = plannerChat.providerId?.trim() ?? '';
  let modelId = plannerChat.modelId?.trim() ?? '';

  if (!modelId && isDomAvailable()) {
    const domRaw =
      (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim() ??
      '';
    if (domRaw) {
      const parsed = decodeModelSelectKey(domRaw);
      if (parsed) {
        providerId = providerId || parsed.providerId;
        modelId = parsed.modelId;
      } else {
        modelId = domRaw;
      }
    }
  }

  if (!modelId) {
    const meta = getAutopilotMetaSync();
    providerId = providerId || meta.plannerProviderId?.trim() || '';
    modelId = meta.plannerModelId?.trim() || '';
  }

  return { providerId, modelId };
}

/** @deprecated Use {@link resolveBoardModelBinding}. */
export function resolvePlannerModelBinding(plannerChat: Chat): {
  providerId: string;
  modelId: string;
} {
  return resolveBoardModelBinding(plannerChat);
}
