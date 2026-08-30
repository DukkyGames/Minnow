/**
 * Server-side model binding for a real attempt (P2-F).
 *
 * Behaviour reference: `src/chat/orchestrate/board-model-binding.ts`
 * (board override → planner chat → top-bar picker → autopilot planner).
 * That module reads the DOM; this one must not. The server analogue is:
 *
 *   1. explicit override — the board's own `board.model.set` binding (P9-C),
 *      or a test's `model` option
 *   2. Settings → Autopilot planner provider/model (`config.json`)
 *   3. active chat's menubar binding (sessions store — no `document`)
 *
 * A missing binding throws. `POST /start` calls the effector's `preflight()`
 * first, so that throw becomes a 400 on the button (P9-A). If it happens later
 * in a run instead, `start()` rejects, the engine journals nothing (no process
 * existed), emits a non-journaled `error` frame, and the next tick retries.
 */

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
 * Missing or uninitialised sessions are not a crash — they are "no binding".
 *
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
