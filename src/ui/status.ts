import { closeDrawer } from './settings';
import { closeMobileSidebar } from './layout';

export function serverUrl(): string {
  return (document.getElementById('serverUrl') as HTMLInputElement).value.trim().replace(/\/$/, '');
}

/** Validate LM Studio base URL before network calls. */
export function parseServerBaseUrl(raw: string): string | null {
  const trimmed = (raw || '').trim().replace(/\/$/, '');
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function setStatus(state: string, msg: string): void {
  document.getElementById('sDot')!.className = `s-dot ${state}`;
  document.getElementById('sText')!.textContent = msg;
}

/** Close settings drawer or mobile chat list when Escape is pressed. */
export function dismissOpenLayers(): void {
  const drawer = document.getElementById('drawer');
  if (drawer && drawer.classList.contains('open')) {
    closeDrawer();
    return;
  }
  const side = document.getElementById('chatSidebar');
  if (side && side.classList.contains('mobile-open')) {
    closeMobileSidebar();
  }
}
