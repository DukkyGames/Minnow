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
