export const BOARD_SETUP_BANNER_ID = 'boardSetupReturnBanner';

/** Remove the leftover setup return banner if it is still in the DOM. */
export function removeBoardSetupReturnBanner(): void {
  document.getElementById(BOARD_SETUP_BANNER_ID)?.remove();
}

/** No-op: planner-chat board setup is gone (MIN-715). */
export function syncBoardSetupReturnBanner(_chat?: unknown): void {
  removeBoardSetupReturnBanner();
}
