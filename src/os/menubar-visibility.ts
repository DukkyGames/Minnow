import type { AppId } from './types';

/** Show the mobile chat/session toggle when Code or Chat is foreground. */
export function isChatToggleVisible(fgApp: AppId | null): boolean {
  return fgApp === 'code' || fgApp === 'chat';
}

/** Show menubar center slot (settings search) while Settings is foreground. */
export function isMenubarCenterVisible(fgApp: AppId | null): boolean {
  return fgApp === 'settings';
}

/** Accessible label for the shared Code/Chat sidebar toggle button. */
export function chatToggleAriaLabel(fgApp: AppId | null): string | null {
  if (fgApp === 'chat') return 'Session rail';
  if (fgApp === 'code') return 'Chat sidebar';
  return null;
}
