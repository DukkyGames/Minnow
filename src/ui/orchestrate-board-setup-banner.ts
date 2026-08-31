/**
 * Chat-view banner for leftover V1 board setup (MIN-340).
 *
 * P4-C retired planner-chat setup chrome. Incomplete V1 folders no longer
 * prompt a return-to-setup banner — open Boards instead.
 */

export const BOARD_SETUP_BANNER_ID = 'boardSetupReturnBanner';

/** Remove the leftover setup return banner if it is still in the DOM. */
export function removeBoardSetupReturnBanner(): void {
  document.getElementById(BOARD_SETUP_BANNER_ID)?.remove();
}

/** No-op: planner-chat board setup is gone (MIN-715). */
export function syncBoardSetupReturnBanner(_chat?: unknown): void {
  removeBoardSetupReturnBanner();
}
