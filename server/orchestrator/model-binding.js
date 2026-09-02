/** Resolve the model a real attempt should use. */

import { readConfigJson } from '../config/store.js';

/**
 * @param {{ providerId?: string, id?: string } | null | undefined} override
 * @returns {Promise<{ providerId: string, id: string }>}
 */
export async function resolveAttemptModel(override) {
  const fromOverride = trimPair(override?.providerId, override?.id);
  if (fromOverride) return fromOverride;

  const cfg = (await readConfigJson('config.json')) ?? {};
  const autopilot =
    cfg.autopilot && typeof cfg.autopilot === 'object'
      ? /** @type {Record<string, unknown>} */ (cfg.autopilot)
      : {};
  const fromAutopilot = trimPair(autopilot.plannerProviderId, autopilot.plannerModelId);
  if (fromAutopilot) return fromAutopilot;

  const fromChat = await readActiveChatPair();
  if (fromChat) return fromChat;

  throw new Error(
    'no model bound for this attempt: set Settings → Autopilot planner model, or select a model in the menubar',
  );
}

/**
 * @param {unknown} providerId
 * @param {unknown} modelId
 * @returns {{ providerId: string, id: string } | null}
 */
function trimPair(providerId, modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  const provider = typeof providerId === 'string' ? providerId.trim() : '';
  if (!id || !provider) return null;
  return { providerId: provider, id };
}

/**
 * Active chat menubar binding, if the sessions store is available.
 * @returns {Promise<{ providerId: string, id: string } | null>}
 */
async function readActiveChatPair() {
  try {
    const { readActiveChatModelBinding } = await import('../config/sessions-repo.js');
    const binding = readActiveChatModelBinding();
    return trimPair(binding?.providerId, binding?.modelId);
  } catch {
    return null;
  }
}
