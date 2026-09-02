import { emitChatSidebarChanged } from './layout-events';

export const SUPER_PLAN_OPEN_CLASS = 'mn-super-plan-open';

/** Reflect Super Plan's on-screen state into the view bar and the shell. */
export function syncSuperPlanChrome(open: boolean): void {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.toggle(SUPER_PLAN_OPEN_CLASS, open);

  const btn = document.getElementById('btnSuperPlan');
  if (btn) {
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  emitChatSidebarChanged();
  void import('./preview-electron-visibility').then((m) => {
    m.scheduleElectronPreviewHostLayoutSync();
  });
}

/** True when the shell is currently in the Super Plan chrome state. */
export function isSuperPlanChromeActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains(SUPER_PLAN_OPEN_CLASS);
}
