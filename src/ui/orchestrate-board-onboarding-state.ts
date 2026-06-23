/**
 * Transient UI flags for orchestrate board onboarding (git preflight + kickoff).
 */

/** True while /git-setup skill turn runs before board_init. */
let boardOnboardingGitSetupActive = false;

/** True while kickoff preflight (ask_question / git setup) is in flight. */
let boardKickoffInProgress = false;

type OnboardingStateListener = () => void;
const listeners = new Set<OnboardingStateListener>();

function notifyOnboardingStateListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  }
}

/** Subscribe to git-setup / kickoff flag changes (onboarding busy UI). */
export function subscribeBoardOnboardingState(listener: OnboardingStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isBoardOnboardingGitSetupActive(): boolean {
  return boardOnboardingGitSetupActive;
}

export function setBoardOnboardingGitSetupActive(active: boolean): void {
  if (boardOnboardingGitSetupActive === active) return;
  boardOnboardingGitSetupActive = active;
  notifyOnboardingStateListeners();
}

export function isBoardKickoffInProgress(): boolean {
  return boardKickoffInProgress;
}

/** Returns true when kickoff was already in progress (caller should bail). */
export function setBoardKickoffInProgress(active: boolean): boolean {
  if (active && boardKickoffInProgress) return true;
  boardKickoffInProgress = active;
  notifyOnboardingStateListeners();
  return false;
}
