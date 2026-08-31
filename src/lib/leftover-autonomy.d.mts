/** Collapse inbound leftover-board flags onto status + concurrency. */
export function foldLeftoverBoardAutonomy(
  board: { status?: 'running' | 'stopped'; maxConcurrentTasks?: number },
  raw: Record<string, unknown>,
): void;

/** Map persisted Autopilot autonomy onto Running / Stopped. */
export function foldAutopilotDefaultStatus(
  block: Record<string, unknown>,
): 'running' | 'stopped';

/** Drop stale Autopilot keys so they cannot be re-read as live settings. */
export function stripStaleAutopilotKeys(block: Record<string, unknown>): void;
