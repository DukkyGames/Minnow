/**
 * Full board teardown when navigating away from board view (MIN-207).
 */

import { dismissActiveBoardView } from '../state/chat-groups';
import { syncOrchestrateInitSplitChrome } from './orchestrate-board-init-split';
import { disposeOrchestrateBoardSession } from './orchestrate-board';

/** Dismiss board session state, dispose listeners, and sync init-split chrome. */
export function exitBoardViewForNavigation(): boolean {
  const boardWasOpen = dismissActiveBoardView();
  if (!boardWasOpen) return false;
  disposeOrchestrateBoardSession();
  syncOrchestrateInitSplitChrome();
  return true;
}
