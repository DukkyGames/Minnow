/**
 * Chat-view banner to return to in-progress orchestrate board setup (MIN-340).
 */

import {
  isBoardOnboardingBusy,
  shouldShowBoardSetupReturnBanner,
} from '../chat/orchestrate/board-setup';
import { getActiveChat } from '../state/sessions';
import type { Chat } from '../types';
import { cancelBoardOnboardingSetup } from './orchestrate-board-onboarding-ui';
import { setOrchestrateViewMode } from './view-mode-toggle';

export const BOARD_SETUP_BANNER_ID = 'boardSetupReturnBanner';

/** Remove the setup return banner when board view or another surface owns the column. */
export function removeBoardSetupReturnBanner(): void {
  document.getElementById(BOARD_SETUP_BANNER_ID)?.remove();
}

/** Insert or refresh the setup return banner at the top of #chatArea. */
export function syncBoardSetupReturnBanner(chat: Chat = getActiveChat()): void {
  const area = document.getElementById('chatArea');
  if (!area) return;

  if (!shouldShowBoardSetupReturnBanner(chat)) {
    removeBoardSetupReturnBanner();
    return;
  }

  let banner = document.getElementById(BOARD_SETUP_BANNER_ID) as HTMLElement | null;
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BOARD_SETUP_BANNER_ID;
    banner.className = 'board-setup-return-banner';
    banner.setAttribute('role', 'status');

    const text = document.createElement('p');
    text.className = 'board-setup-return-banner__text';
    text.dataset.boardSetupBannerText = '';

    const actions = document.createElement('div');
    actions.className = 'board-setup-return-banner__actions';

    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'board-setup-return-banner__resume';
    resumeBtn.textContent = 'Return to board setup';
    resumeBtn.addEventListener('click', () => {
      setOrchestrateViewMode('board');
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'board-setup-return-banner__cancel';
    cancelBtn.textContent = 'Cancel setup';
    cancelBtn.addEventListener('click', () => {
      cancelBoardOnboardingSetup(chat.id);
      syncBoardSetupReturnBanner(chat);
    });

    actions.append(resumeBtn, cancelBtn);
    banner.append(text, actions);
    area.insertBefore(banner, area.firstChild);
  }

  const textEl = banner.querySelector('[data-board-setup-banner-text]');
  if (textEl instanceof HTMLElement) {
    textEl.textContent = isBoardOnboardingBusy()
      ? 'Board setup is in progress. Return to finish git checks and board initialization.'
      : 'Board setup is not finished. Return to pick a plan and build the board.';
  }
}
