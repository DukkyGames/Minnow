/**
 * Migration of the retired four-value board `executionMode` onto the two fields that
 * replaced it: `maxConcurrentTasks` (parallelism) and `handsOff` (autonomy).
 *
 * Shared by the session-schema normalizer (hydration/persistence) and the dev board
 * seeder, so a legacy board lands the same way wherever it is read.
 *
 * @param {{ handsOff?: boolean, maxConcurrentTasks?: number, autoRunning?: boolean }} board
 * @param {string | undefined} mode
 */
export function applyLegacyExecutionMode(board, mode) {
  switch (mode) {
    case 'afk':
      board.handsOff = true;
      break;
    case 'sequential':
      board.maxConcurrentTasks = 1;
      break;
    case 'manual':
      // A board that was never started is the manual case now; pin it to
      // one-at-a-time and leave it stopped.
      board.maxConcurrentTasks = 1;
      board.autoRunning = false;
      break;
    case 'auto':
    default:
      break;
  }
}
