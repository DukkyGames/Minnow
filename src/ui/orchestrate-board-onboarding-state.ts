let boardOnboardingGitSetupActive = false;

/** True while kickoff preflight (git prompt / git setup) is in flight. */
let boardKickoffInProgress = false;

/** True from leftover kickoff send until stream ends or a store appears (reduces picker flicker). */
let boardOnboardingAwaitingInit = false;

/** AbortController for the active kickoff sequence (git prompt, git skill, pre-send). */
let kickoffAbort: AbortController | null = null;

type GitSetupPromptResolver = (accepted: boolean) => void;
let gitSetupPromptResolver: GitSetupPromptResolver | null = null;

/** Which inline git question is waiting for the user (init vs remote). */
export type BoardGitPromptKind = 'init' | 'remote';
let gitSetupPromptKind: BoardGitPromptKind = 'init';

type OnboardingStateListener = () => void;
const listeners = new Set<OnboardingStateListener>();

function notifyOnboardingStateListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
    }
  }
}

/** Subscribe to onboarding flag changes (busy UI, git prompt). */
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

export function isBoardOnboardingAwaitingInit(): boolean {
  return boardOnboardingAwaitingInit;
}

export function setBoardOnboardingAwaitingInit(active: boolean): void {
  if (boardOnboardingAwaitingInit === active) return;
  boardOnboardingAwaitingInit = active;
  notifyOnboardingStateListeners();
}

/** Returns true when kickoff was already in progress (caller should bail). */
export function setBoardKickoffInProgress(active: boolean): boolean {
  if (active && boardKickoffInProgress) return true;
  boardKickoffInProgress = active;
  if (active) {
    kickoffAbort = new AbortController();
  } else {
    kickoffAbort = null;
  }
  notifyOnboardingStateListeners();
  return false;
}

/** Signal for kickoff cancellation (user Cancel or navigation). */
export function getBoardKickoffAbortSignal(): AbortSignal | undefined {
  return kickoffAbort?.signal;
}

export function isBoardGitSetupPromptActive(): boolean {
  return gitSetupPromptResolver !== null;
}

export function getBoardGitSetupPromptKind(): BoardGitPromptKind {
  return gitSetupPromptKind;
}

/** Show the inline git setup question in board onboarding and wait for the user's choice. */
export function promptBoardGitSetup(kind: BoardGitPromptKind): Promise<boolean> {
  return new Promise((resolve) => {
    gitSetupPromptKind = kind;
    gitSetupPromptResolver = (accepted) => {
      gitSetupPromptResolver = null;
      notifyOnboardingStateListeners();
      resolve(accepted);
    };
    notifyOnboardingStateListeners();
  });
}

/** Resolve the pending git setup prompt (yes / no / cancel). */
export function resolveBoardGitSetupPrompt(accepted: boolean): void {
  const resolver = gitSetupPromptResolver;
  if (!resolver) return;
  gitSetupPromptResolver = null;
  notifyOnboardingStateListeners();
  resolver(accepted);
}

/** Clear transient onboarding flags (tests and cancel). */
export function resetBoardOnboardingTransientState(): void {
  kickoffAbort?.abort();
  boardOnboardingGitSetupActive = false;
  boardKickoffInProgress = false;
  boardOnboardingAwaitingInit = false;
  kickoffAbort = null;
  if (gitSetupPromptResolver) {
    gitSetupPromptResolver(false);
  } else {
    gitSetupPromptResolver = null;
  }
  gitSetupPromptKind = 'init';
}
