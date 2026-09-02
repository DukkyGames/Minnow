import { normalizeOrchestratePlanPath } from '../chat/plans/plan-path';

/** What a plan launch resolved to. No chat row — V2 boards are journals. */
export interface BoardLaunchResult {
  boardId: string;
}

/** Create a V2 board from a plan file and open the Boards surface on it. */
export async function launchBoardFromPlan(
  planPath: string,
): Promise<BoardLaunchResult | null> {
  const norm = normalizeOrchestratePlanPath(planPath);
  if (!norm) return null;

  const { openBoardsView, showBoard } = await import('../orchestrator/boards-view');
  await openBoardsView();
  const { navigateToCodeBoards } = await import('../os/router');
  navigateToCodeBoards();

  try {
    const { createBoardFromPlan } = await import('../orchestrator/client');
    const { boardId } = await createBoardFromPlan(norm);
    showBoard(boardId);
    return { boardId };
  } catch (err) {
    console.error('[orchestrate] create board from plan failed', err);
    return null;
  }
}
