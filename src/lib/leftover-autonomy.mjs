/**
 * Collapse inbound V1 leftover-board and Autopilot flags onto the V2 pair
 * (status enum + concurrency integer). MIN-718 / P4-F.
 *
 * The six V1 names are read here so they can be dropped on write. They are not
 * copied onto the result, so a leftover blob cannot encode a contradictory
 * combination after hydrate.
 */

/**
 * Map a leftover session board onto `status` + `maxConcurrentTasks`.
 *
 * @param {{ status?: 'running' | 'stopped', maxConcurrentTasks?: number }} board
 * @param {Record<string, unknown>} raw
 */
export function foldLeftoverBoardAutonomy(board, raw) {
  const mode = typeof raw.executionMode === 'string' ? raw.executionMode.trim() : '';
  if (mode === 'sequential' || mode === 'manual') {
    board.maxConcurrentTasks = 1;
  }

  if (raw.status === 'running' || raw.status === 'stopped') {
    board.status = raw.status;
    return;
  }

  if (raw.userStopped === true || raw.systemPaused === true || mode === 'manual') {
    board.status = 'stopped';
    return;
  }

  if (
    raw.autoRunning === true ||
    raw.handsOff === true ||
    mode === 'afk' ||
    mode === 'auto' ||
    mode === 'sequential'
  ) {
    board.status = 'running';
  }
}

/**
 * Map persisted Autopilot autonomy onto Running / Stopped.
 * AFK (and auto/sequential) → running; Manual or an explicit stop → stopped.
 *
 * @param {Record<string, unknown>} block
 * @returns {'running' | 'stopped'}
 */
export function foldAutopilotDefaultStatus(block) {
  if (block.defaultStatus === 'running' || block.defaultStatus === 'stopped') {
    return block.defaultStatus;
  }
  if (block.defaultHandsOff === true) return 'running';
  const mode =
    typeof block.defaultExecutionMode === 'string' ? block.defaultExecutionMode.trim() : '';
  if (mode === 'manual') return 'stopped';
  if (mode === 'afk' || mode === 'auto' || mode === 'sequential') return 'running';
  return 'stopped';
}

/**
 * Drop stale Autopilot keys so they cannot be re-read as live settings.
 *
 * @param {Record<string, unknown>} block
 */
export function stripStaleAutopilotKeys(block) {
  delete block.defaultHandsOff;
  delete block.defaultExecutionMode;
}
