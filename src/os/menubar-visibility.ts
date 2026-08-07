import type { AppId } from './types';

/** Show the mobile chat/session toggle when Code is foreground. */
export function isChatToggleVisible(fgApp: AppId | null): boolean {
  return fgApp === 'code';
}

/** Accessible label for the shared Code sidebar toggle button. */
export function chatToggleAriaLabel(fgApp: AppId | null): string | null {
  if (fgApp === 'code') return 'Chat sidebar';
  return null;
}
