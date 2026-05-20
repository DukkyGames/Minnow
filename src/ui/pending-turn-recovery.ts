/**
 * Interrupted-generation recovery banner (feature 22).
 */

import { clearPendingTurn } from '../state/pending-turn';
import type { Chat } from '../types';

const BANNER_ID = 'pendingTurnRecoveryBanner';

function getBannerHost(): HTMLElement | null {
  return document.getElementById('mainColumn');
}

/** Remove recovery banner if present. */
export function dismissPendingTurnRecovery(): void {
  document.getElementById(BANNER_ID)?.remove();
}

/** Show Continue / Discard when a chat has a checkpointed pending turn. */
export function showPendingTurnRecovery(chat: Chat): void {
  if (!chat.pendingTurn) {
    dismissPendingTurnRecovery();
    return;
  }

  dismissPendingTurnRecovery();
  const host = getBannerHost();
  if (!host) return;

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
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
    void import('./messages').then((m) => m.renderChatFromHistory(chat));
  });

  banner.querySelector('[data-pending-continue]')?.addEventListener('click', () => {
    dismissPendingTurnRecovery();
    const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
    if (input) {
      input.focus();
      input.placeholder = 'Press Send to continue from the checkpoint…';
    }
  });

  host.prepend(banner);
}

/** Boot / chat switch: show recovery UI when a pending turn exists. */
export function initPendingTurnRecoveryForChat(chat: Chat): void {
  showPendingTurnRecovery(chat);
}
