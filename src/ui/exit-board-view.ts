/**
 * Full board teardown when navigating away from board view (MIN-207).
 */

import { dismissActiveBoardView } from '../state/chat-groups';
import { syncOrchestrateInitSplitChrome } from './orchestrate-board-init-split';
import { disposeOrchestrateBoardSession } from './orchestrate-board';
import { closeBoardChatEmbedForTeardown } from './orchestrate-board-chat';

/**
 * Release the Orchestrate surface's hold on #chatArea.
 *
 * `chat-area--orchestrate` makes the column read as a full-column overlay to
 * `isMainColumnOverlaySuppressingChatDom`, which then refuses to paint a
 * transcript over it. renderChatFromHistory only strips that class *after* the
 * same guard has already returned, so leaving a board used to leave the board
 * page on screen with the composer hidden. Clearing it here, at the point of
 * navigation, is what lets the next chat paint.
 */
function releaseOrchestrateChatArea(): void {
  const area = document.getElementById('chatArea');
  if (!area) return;
  area.classList.remove('chat-area--orchestrate', 'chat-area--orchestrate-hub');
  area.querySelector(':scope > .ob-page')?.remove();
}

/** Dismiss board session state, dispose listeners, and sync init-split chrome. */
export function exitBoardViewForNavigation(): boolean {
  // An embedded board chat cannot outlive its board: it has no row in the
  // chats panel to return from.
  closeBoardChatEmbedForTeardown();
  const boardWasOpen = dismissActiveBoardView();
  const area = document.getElementById('chatArea');
  const hadBoardDom = Boolean(
    area?.querySelector(':scope > .ob-page, :scope > .board-root'),
  );
  if (!boardWasOpen && !hadBoardDom) return false;
  disposeOrchestrateBoardSession();
  releaseOrchestrateChatArea();
  syncOrchestrateInitSplitChrome();
  return true;
}
