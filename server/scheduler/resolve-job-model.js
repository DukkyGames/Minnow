/**
 * Resolve provider/model for a scheduled job run.
 * Jobs may pin a model; otherwise fall back to the active chat menubar selection.
 */

import {
  readActiveChatModelBinding,
  useJsonSessionsStore,
} from '../config/sessions-repo.js';
import { readResource } from '../config/store.js';

/**
 * @param {object} storedJob
 * @returns {Promise<{ providerId?: string; modelId?: string }>}
 */
export async function resolveJobRunModel(storedJob) {
  const providerId = storedJob.providerId?.trim();
  const modelId = storedJob.modelId?.trim();
  if (modelId) {
    return { providerId: providerId || undefined, modelId };
  }

  // Hot path: indexed active chat provider/model (decode left to callers if needed).
  if (!useJsonSessionsStore()) {
    const binding = readActiveChatModelBinding();
    if (binding?.modelId?.trim()) {
      return {
        providerId: binding.providerId?.trim() || undefined,
        modelId: binding.modelId.trim(),
      };
    }
    return { providerId: undefined, modelId: undefined };
  }

  // JSON rollback: whole-blob resource read.
  const sessions = await readResource('sessions');
  const activeId = typeof sessions?.activeId === 'string' ? sessions.activeId : '';
  const chats = Array.isArray(sessions?.chats) ? sessions.chats : [];
  const active = chats.find(
    (chat) => chat && typeof chat === 'object' && chat.id === activeId,
  );
  if (active?.modelId?.trim()) {
    return {
      providerId: active.providerId?.trim() || undefined,
      modelId: active.modelId.trim(),
    };
  }

  return { providerId: undefined, modelId: undefined };
}
