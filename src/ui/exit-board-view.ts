import { dismissActiveBoardView } from '../state/chat-groups';
import { syncOrchestrateInitSplitChrome } from './orchestrate-board-init-split';
import { closeBoardChatEmbedForTeardown } from './orchestrate-board-chat';

function releaseOrchestrateChatArea(): void {
  const area = document.getElementById('chatArea');
  if (!area) return;
  area.classList.remove('chat-area--orchestrate', 'chat-area--orchestrate-hub');
  area.querySelector(':scope > .ob-page')?.remove();
}

/** Dismiss board session state, dispose listeners, and sync init-split chrome. */
export function exitBoardViewForNavigation(): boolean {
  closeBoardChatEmbedForTeardown();
  const boardWasOpen = dismissActiveBoardView();
  const area = document.getElementById('chatArea');
  const hadBoardDom = Boolean(
    area?.querySelector(':scope > .ob-page, :scope > .board-root'),
  );
  if (!boardWasOpen && !hadBoardDom) return false;
  releaseOrchestrateChatArea();
  syncOrchestrateInitSplitChrome();
  return true;
}
