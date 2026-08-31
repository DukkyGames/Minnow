import type { BoardState } from './core/types';

/** True when this board should list/start under `workspaceRoot`. */
export function boardBelongsToWorkspace(
  state: BoardState,
  workspaceRoot?: string,
): Promise<boolean>;
