/**
 * Chrome that reacts to the Super Plan surface being on screen.
 *
 * Two things change while the planning surface owns the stage:
 *
 *   - `#btnSuperPlan` in the Code view bar reads pressed, like Orchestrate and
 *     Dev servers do for theirs.
 *   - The chat session list is hidden. Super Plan carries its own rail of plans,
 *     and two lists side by side — one of chats, one of the runs those chats
 *     are — read as one confused column. The user's own collapsed/expanded
 *     preference is never written; this is a document-level override that lifts
 *     the moment the surface closes.
 *
 * Lives apart from both `orchestrate-plan-screen.ts` (which mounts the surface)
 * and `super-plan-entry.ts` (which opens it from the top bar) so those two can
 * each call it without importing one another.
 */

export const SUPER_PLAN_OPEN_CLASS = 'mn-super-plan-open';

/** Reflect Super Plan's on-screen state into the view bar and the shell. */
export function syncSuperPlanChrome(open: boolean): void {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.toggle(SUPER_PLAN_OPEN_CLASS, open);

  const btn = document.getElementById('btnSuperPlan');
  if (!btn) return;
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/** True when the shell is currently in the Super Plan chrome state. */
export function isSuperPlanChromeActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains(SUPER_PLAN_OPEN_CLASS);
}
