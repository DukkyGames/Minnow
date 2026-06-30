import { ICON_CHEVRON_LEFT, ICON_CHEVRON_RIGHT } from '../constants';
import { sessionState } from '../state/sessions';
import { scheduleSaveSessions } from '../state/sessions';
import { mountOsMobileDrawerBackdrops, syncOsMobileDrawerHtmlClass } from './mobile-drawer-portal';

export function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 640px)').matches;
}

export function closeMobileSidebar(): void {
  const side = document.getElementById('chatSidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (side) side.classList.remove('mobile-open');
  syncOsMobileDrawerHtmlClass('chat', false);
  if (bd) {
    bd.classList.remove('open');
    bd.setAttribute('aria-hidden', 'true');
    (bd as HTMLButtonElement).tabIndex = -1;
  }
}

export function openMobileSidebar(): void {
  if (!isMobileLayout()) return;
  mountOsMobileDrawerBackdrops();
  const side = document.getElementById('chatSidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (side) side.classList.add('mobile-open');
  syncOsMobileDrawerHtmlClass('chat', true);
  if (bd) {
    bd.classList.add('open');
    bd.setAttribute('aria-hidden', 'false');
    (bd as HTMLButtonElement).tabIndex = 0;
  }
}

export function applySidebarVisuals(): void {
  const side = document.getElementById('chatSidebar');
  const btn = document.getElementById('btnSidebarCollapse');
  if (!side || !btn || !sessionState) return;
  if (isMobileLayout()) {
    mountOsMobileDrawerBackdrops();
    syncOsMobileDrawerHtmlClass('chat', side.classList.contains('mobile-open'));
  } else {
    syncOsMobileDrawerHtmlClass('chat', false);
  }
  if (!isMobileLayout()) {
    closeMobileSidebar();
    side.classList.toggle('collapsed', sessionState.sidebarCollapsed);
    btn.innerHTML = sessionState.sidebarCollapsed ? ICON_CHEVRON_RIGHT : ICON_CHEVRON_LEFT;
    btn.setAttribute(
      'aria-label',
      sessionState.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
    );
  } else {
    side.classList.toggle('collapsed', sessionState.sidebarCollapsed);
    btn.innerHTML = side.classList.contains('mobile-open') ? ICON_CHEVRON_LEFT : ICON_CHEVRON_RIGHT;
    btn.setAttribute(
      'aria-label',
      side.classList.contains('mobile-open') ? 'Close chat list' : 'Open chat list'
    );
  }
  scheduleElectronPreviewHostLayoutAfterChatSidebarChange();
}

/** Re-align the Electron preview guest when the chat rail width changes. */
function scheduleElectronPreviewHostLayoutAfterChatSidebarChange(): void {
  void import('../state/file-panel').then(({ getFilePanelState }) => {
    if (getFilePanelState().rightPaneMode !== 'preview') return;
    void import('./preview-electron-visibility').then((m) => {
      m.scheduleElectronPreviewHostLayoutSync();
    });
  });
}

export function toggleSidebarLayout(): void {
  if (isMobileLayout()) {
    const side = document.getElementById('chatSidebar');
    if (side && side.classList.contains('mobile-open')) closeMobileSidebar();
    else openMobileSidebar();
    applySidebarVisuals();
  } else {
    sessionState!.sidebarCollapsed = !sessionState!.sidebarCollapsed;
    applySidebarVisuals();
    scheduleSaveSessions();
  }
}

export function toggleSidebarCollapsed(): void {
  if (isMobileLayout()) {
    closeMobileSidebar();
    applySidebarVisuals();
    return;
  }
  sessionState!.sidebarCollapsed = !sessionState!.sidebarCollapsed;
  applySidebarVisuals();
  scheduleSaveSessions();
}
