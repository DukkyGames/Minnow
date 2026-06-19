/**
 * Boot-time resume for orchestrate boards after page reload.
 * Mirrors generation-resume.ts for chat.currentGenerationId.
 */

import { getPlannerChatForGroup } from '../../state/chat-groups.ts';
import { resumeBoardExecutionAfterReload } from '../../state/orchestrate-board-actions.ts';
import { isBoardRunning } from '../../state/orchestrate-board-store.ts';
import type { SessionState } from '../../types.ts';

/** Resume auto/sequential delegation for boards that were running before reload. */
export async function bootOrchestrateBoardResume(state: SessionState): Promise<void> {
  for (const group of state.groups ?? []) {
    if (!isBoardRunning(group)) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await resumeBoardExecutionAfterReload(group, planner);
  }
}
