import { ICON_CHEVRON_LEFT, ICON_CHEVRON_RIGHT } from '../constants';
import { sessionState } from '../state/sessions';
import { scheduleSaveSessions } from '../state/sessions';

export function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 640px)').matches;
}

export function closeMobileSidebar(): void {
  const side = document.getElementById('chatSidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (side) side.classList.remove('mobile-open');
  if (bd) {
    bd.classList.remove('open');
    bd.setAttribute('aria-hidden', 'true');
    (bd as HTMLButtonElement).tabIndex = -1;
  }
}

export function openMobileSidebar(): void {
  if (!isMobileLayout()) return;
  const side = document.getElementById('chatSidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (side) side.classList.add('mobile-open');
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
