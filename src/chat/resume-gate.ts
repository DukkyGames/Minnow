/**
 * Boot-time hold on every auto-resume path until the user answers the resume prompt.
 * Mirrors oom-recovery.ts: a single flag the auto-start paths bail out on.
 */

/**
 * `pending` — the prompt is up (or about to be) and nothing may start.
 * `declined` — the user said no; the hold stays for the rest of the session so a
 * later display wake cannot quietly re-arm what they just declined.
 * `resumed` / `idle` — normal operation.
 */
export type ResumeGateState = 'idle' | 'pending' | 'resumed' | 'declined';

let gateState: ResumeGateState = 'idle';

/** Whether auto-resume paths must stand down (prompt unanswered or declined). */
export function isResumeGateHeld(): boolean {
  return gateState === 'pending' || gateState === 'declined';
}

/** Current gate state (diagnostics and tests). */
export function getResumeGateState(): ResumeGateState {
  return gateState;
}

/** Set the gate state (boot gate and tests). */
export function setResumeGateState(state: ResumeGateState): void {
  gateState = state;
}
