import type { TerminalTabKind } from './terminal-tabs';

/** Whether the UI may switch to the Agent output tab (MIN-242). */
export function shouldSwitchToAgentTab(input: {
  panelOpen: boolean;
  userInitiated: boolean;
  autoFollowAgentTab: boolean;
}): boolean {
  if (!input.panelOpen) return false;
  return input.userInitiated || input.autoFollowAgentTab;
}

/** Whether the Agent tab should show the off-tab activity badge. */
export function shouldShowAgentTabActivityBadge(input: {
  panelOpen: boolean;
  activeTabKind: TerminalTabKind;
  activityDepth: number;
}): boolean {
  return (
    input.panelOpen &&
    input.activeTabKind !== 'agent' &&
    input.activityDepth > 0
  );
}
