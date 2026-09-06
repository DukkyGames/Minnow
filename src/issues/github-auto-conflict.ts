/**
 * How auto-sync surfaces a conflict without picking a winner.
 *
 * Peek open on that card → the existing Keep mine / Keep GitHub pane.
 * Peek closed → a toast. Never last-writer-wins.
 */

/** Toast copy when auto-sync finds a conflict and the peek is not on that card. */
export function githubAutoConflictToast(number: number): string {
  return `Both sides changed on #${number}. Open the issue to pick.`;
}

/** True when the open peek can show the conflict pane for this card. */
export function githubAutoConflictShouldUsePeek(
  conflictIssueId: string,
  openIssueId: string | undefined,
): boolean {
  return Boolean(openIssueId) && openIssueId === conflictIssueId;
}
