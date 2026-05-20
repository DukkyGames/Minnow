/**
 * Boot-time and chat-switch recovery: auto-resume from `pendingTurn`, or offer
 * retry when the last history row is a lone user message (checkpoint lost).
 */

import { streaming } from '../app-state';
import { indexOfLastUserMessage } from './history-truncate-core';
import { requestContinueFromPendingTurn } from '../state/pending-turn';
import {
  isUserStoppedPendingCheckpoint,
  shouldOfferRecovery,
} from '../state/pending-turn-shape';
import type { Chat } from '../types';
import { setStatus } from '../ui/status';

/** True when there is no valid `pendingTurn` but history ends with a user row (no reply yet). */
export function hasOrphanUserTurnAwaitingReply(chat: Chat): boolean {
  if (shouldOfferRecovery(chat)) {
    return false;
  }
  const last = chat.history[chat.history.length - 1];
  return last?.role === 'user';
}

/** Index of the last user message when {@link hasOrphanUserTurnAwaitingReply} is true. */
export function getOrphanUserTurnIndex(chat: Chat): number | null {
  if (!hasOrphanUserTurnAwaitingReply(chat)) {
    return null;
  }
  const idx = indexOfLastUserMessage(chat.history);
  return idx >= 0 ? idx : null;
}

/** Read the composer model picker (empty when none selected). */
function getSelectedModelIdFromDom(): string {
  const el = document.getElementById('modelSelect') as HTMLSelectElement | null;
  return el?.value?.trim() ?? '';
}

/**
 * Arm the continue-from-pending send path and run the default tool loop send.
 * Caller must ensure `chat` is the active chat.
 */
export async function resumePendingTurn(_chat: Chat): Promise<void> {
  requestContinueFromPendingTurn();
  const { sendMessage } = await import('./messaging');
  await sendMessage();
}

/**
 * After session load or chat switch: auto-resume when `pendingTurn` exists and a model
 * is selected; otherwise show recovery chrome. When the checkpoint is missing but the
 * tail user message has no reply, show the orphan retry banner.
 */
export async function bootTurnRecoveryForChat(chat: Chat): Promise<void> {
  if (streaming) {
    return;
  }

  const { dismissPendingTurnRecovery } = await import('../ui/pending-turn-recovery');

  // User explicitly stopped: keep partial visible but never auto-resume after reload.
  if (isUserStoppedPendingCheckpoint(chat)) {
    dismissPendingTurnRecovery();
    return;
  }

  if (shouldOfferRecovery(chat)) {
    dismissPendingTurnRecovery();
    const modelId = getSelectedModelIdFromDom();
    if (!modelId) {
      setStatus('err', 'Select a model to resume');
      const { showPendingTurnNeedsModelBanner } = await import('../ui/pending-turn-recovery');
      showPendingTurnNeedsModelBanner(chat);
      return;
    }

    try {
      await resumePendingTurn(chat);
    } catch {
      dismissPendingTurnRecovery();
      if (hasOrphanUserTurnAwaitingReply(chat)) {
        const { showOrphanUserRetryBanner } = await import('../ui/pending-turn-recovery');
        showOrphanUserRetryBanner(chat);
      } else {
        setStatus('err', 'Could not resume the interrupted reply');
      }
    }
    return;
  }

  if (hasOrphanUserTurnAwaitingReply(chat)) {
    dismissPendingTurnRecovery();
    const { showOrphanUserRetryBanner } = await import('../ui/pending-turn-recovery');
    showOrphanUserRetryBanner(chat);
  } else {
    dismissPendingTurnRecovery();
  }
}
