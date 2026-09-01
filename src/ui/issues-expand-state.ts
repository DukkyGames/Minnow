/**
 * Lightweight expand-run flags for the Issues sparkles expander.
 *
 * Kept free of the generations client so Issues page / messages can read
 * busy + overlay state without pulling `/api/generations` into the store chunk.
 */

export const ISSUES_EXPAND_FORM_ID = 'issuesExpandForm';
export const ISSUES_EXPAND_BACKDROP_ID = 'issuesExpandFormBackdrop';

interface ExpandRunState {
  issueId: string;
}

let activeRun: ExpandRunState | null = null;

/** True while a sparkles expansion is in flight or awaiting Apply/Discard. */
export function isIssueDraftExpanding(issueId?: string): boolean {
  if (!activeRun) return false;
  return issueId ? activeRun.issueId === issueId : true;
}

/** True when the review overlay is mounted and open. */
export function isIssueExpandOverlayOpen(): boolean {
  return document.getElementById(ISSUES_EXPAND_FORM_ID)?.classList.contains('is-open') === true;
}

export function getIssueExpandRunIssueId(): string | undefined {
  return activeRun?.issueId;
}

export function setIssueExpandRun(issueId: string | null): void {
  activeRun = issueId ? { issueId } : null;
}
