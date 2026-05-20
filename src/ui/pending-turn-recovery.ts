/**
 * Interrupted-generation recovery banners (feature 22): pending checkpoint,
 * orphan user tail, missing model, and in-session stop.
 */

import { clearPendingTurn } from '../state/pending-turn';
import type { Chat } from '../types';
import { getOrphanUserTurnIndex, resumePendingTurn } from '../chat/turn-recovery';
import { setComposerRecoveryBlocked } from './composer-send';

const BANNER_ORPHAN_ID = 'orphanUserRetryBanner';
const BANNER_NEEDS_MODEL_ID = 'pendingTurnNeedsModelBanner';
const BANNER_MANUAL_ID = 'pendingTurnRecoveryManualBanner';

function getBannerHost(): HTMLElement | null {
  return document.getElementById('mainColumn');
}

/** Remove any recovery banner from the main column. */
export function dismissPendingTurnRecovery(): void {
  document.getElementById(BANNER_ORPHAN_ID)?.remove();
  document.getElementById(BANNER_NEEDS_MODEL_ID)?.remove();
  document.getElementById(BANNER_MANUAL_ID)?.remove();
  setComposerRecoveryBlocked(false);
}

function renderChat(chat: Chat): void {
  void import('./messages').then((m) => m.renderChatFromHistory(chat));
}

/**
 * `pendingTurn` exists but no model is selected: user must pick a model, then Resume,
 * or Discard the checkpoint.
 */
export function showPendingTurnNeedsModelBanner(chat: Chat): void {
  dismissPendingTurnRecovery();
  const host = getBannerHost();
  if (!host) return;

  const banner = document.createElement('div');
  banner.id = BANNER_NEEDS_MODEL_ID;
  banner.className = 'pending-turn-recovery';
  banner.setAttribute('role', 'status');
  banner.innerHTML =
    '<p class="pending-turn-recovery__text">Select a model to resume this interrupted reply.</p>' +
    '<div class="pending-turn-recovery__actions">' +
    '<button type="button" class="pending-turn-recovery__btn pending-turn-recovery__btn--primary" data-pending-resume>Resume</button>' +
    '<button type="button" class="pending-turn-recovery__btn pending-turn-recovery__btn--secondary" data-pending-discard>Discard</button>' +
    '</div>';

  banner.querySelector('[data-pending-discard]')?.addEventListener('click', () => {
    clearPendingTurn(chat);
    dismissPendingTurnRecovery();
    renderChat(chat);
  });

  banner.querySelector('[data-pending-resume]')?.addEventListener('click', () => {
    const modelId = (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim();
    if (!modelId) {
      void import('./status').then((m) =>
        m.setStatus('err', 'Select a model first'),
      );
      return;
    }
    dismissPendingTurnRecovery();
    void resumePendingTurn(chat).catch(() => {
      void import('./status').then((m) =>
        m.setStatus('err', 'Could not resume the interrupted reply'),
      );
    });
  });

  host.prepend(banner);
}

/**
 * No checkpoint on disk, but the last row is a user message: offer retry (manual resend).
 * Blocks the composer until Retry or Dismiss.
 */
export function showOrphanUserRetryBanner(chat: Chat): void {
  dismissPendingTurnRecovery();
  const host = getBannerHost();
  if (!host) return;

  setComposerRecoveryBlocked(true);

  const banner = document.createElement('div');
  banner.id = BANNER_ORPHAN_ID;
  banner.className = 'pending-turn-recovery';
  banner.setAttribute('role', 'status');
  banner.innerHTML =
    '<p class="pending-turn-recovery__text">Generation was interrupted and could not be recovered.</p>' +
    '<div class="pending-turn-recovery__actions">' +
    '<button type="button" class="pending-turn-recovery__btn pending-turn-recovery__btn--primary" data-orphan-retry>Retry last message</button>' +
    '<button type="button" class="pending-turn-recovery__btn pending-turn-recovery__btn--secondary" data-orphan-dismiss>Dismiss</button>' +
    '</div>';

  banner.querySelector('[data-orphan-dismiss]')?.addEventListener('click', () => {
    dismissPendingTurnRecovery();
  });

  banner.querySelector('[data-orphan-retry]')?.addEventListener('click', () => {
    const idx = getOrphanUserTurnIndex(chat);
    if (idx == null) {
      dismissPendingTurnRecovery();
      return;
    }
    dismissPendingTurnRecovery();
    void import('../chat/resend-from-index').then((m) =>
      m.resendFromIndex(chat.id, idx),
    );
  });

  host.prepend(banner);
}

/**
 * In-session interrupt (e.g. Stop): user chooses Continue (same as reload resume) or Discard.
 */
export function showPendingTurnRecoveryManual(chat: Chat): void {
  if (!chat.pendingTurn) {
    dismissPendingTurnRecovery();
    return;
  }

  dismissPendingTurnRecovery();
  const host = getBannerHost();
  if (!host) return;

  const banner = document.createElement('div');
  banner.id = BANNER_MANUAL_ID;
  banner.className = 'pending-turn-recovery';
  banner.setAttribute('role', 'status');
  banner.innerHTML =
    '<p class="pending-turn-recovery__text">Generation was interrupted.</p>' +
    '<div class="pending-turn-recovery__actions">' +
    '<button type="button" class="pending-turn-recovery__btn pending-turn-recovery__btn--primary" data-pending-continue>Continue</button>' +
    '<button type="button" class="pending-turn-recovery__btn pending-turn-recovery__btn--secondary" data-pending-discard>Discard</button>' +
    '</div>';

  banner.querySelector('[data-pending-discard]')?.addEventListener('click', () => {
    clearPendingTurn(chat);
    dismissPendingTurnRecovery();
    renderChat(chat);
  });

  banner.querySelector('[data-pending-continue]')?.addEventListener('click', () => {
    dismissPendingTurnRecovery();
    void resumePendingTurn(chat).catch(() => {
      void import('./status').then((m) =>
        m.setStatus('err', 'Could not continue the interrupted reply'),
      );
    });
  });

  host.prepend(banner);
}
