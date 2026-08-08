/**
 * Code view bar control for showing/hiding the chat session list.
 * Replaces the foreground Code tile on the OS app rail as the panel toggle.
 */

import { CHAT_SIDEBAR_CHANGED_EVENT } from './layout-events';
import { isChatSidebarOpen, toggleSidebarLayout } from './layout';
import { isSuperPlanChromeActive } from './super-plan-chrome';

function isCodeViewsChatsPanelOpen(): boolean {
  // Super Plan hides the session list in CSS; Chats exits the surface instead of toggling it.
  if (isSuperPlanChromeActive()) return false;
  return isChatSidebarOpen();
}

function syncCodeViewsChatsToggle(btn: HTMLButtonElement): void {
  const open = isCodeViewsChatsPanelOpen();
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  const label = open ? 'Hide chats' : 'Show chats';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

/** Wire `#btnCodeViewsChats` once Code workspace modules load. */
export function initCodeViewsChatsToggle(): void {
  const btn = document.getElementById('btnCodeViewsChats');
  if (!btn || btn.dataset.codeViewsChatsWired === '1') return;
  btn.dataset.codeViewsChatsWired = '1';

  const onSync = (): void => syncCodeViewsChatsToggle(btn as HTMLButtonElement);

  btn.addEventListener('click', () => {
    if (isSuperPlanChromeActive()) {
      void import('./super-plan-entry').then((m) => m.closeSuperPlanScreen());
      return;
    }
    toggleSidebarLayout();
  });
  window.addEventListener(CHAT_SIDEBAR_CHANGED_EVENT, onSync);
  onSync();
}
