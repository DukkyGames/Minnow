export interface CloseToTrayDecisionInput {
  closeToTrayEnabled: boolean;
  explicitQuit: boolean;
  quitInProgress: boolean;
}

export function shouldHideWindowOnClose(input: CloseToTrayDecisionInput): boolean {
  if (input.quitInProgress || input.explicitQuit) return false;
  return input.closeToTrayEnabled;
}

export function shouldQuitOnWindowAllClosed(closeToTrayEnabled: boolean): boolean {
  return !closeToTrayEnabled;
}
