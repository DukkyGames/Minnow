import { closeMobileFileSidebar } from './file-layout';
import { closeDrawer } from './settings';
import { closeMobileSidebar } from './layout';
import { closeSubAgentDrawer } from './sub-agent-drawer';

/** Legacy settings field; Vite-only fallback when /api/providers is unavailable. */
export function serverUrl(): string {
  const el = document.getElementById('serverUrl') as HTMLInputElement | null;
  if (!el) return 'http://localhost:1234';
  return el.value.trim().replace(/\/$/, '');
}

/** Display base URL for the active provider (read-only field in settings). */
export function setActiveProviderBaseUrl(baseUrl: string): void {
  const el = document.getElementById('serverUrl') as HTMLInputElement | null;
  if (el) {
    el.value = baseUrl;
  }
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

/** Topbar pill states — operational feedback only, not model inventory. */
export type StatusState = 'idle' | 'ok' | 'err' | 'spin';

/** Update the topbar status pill (connection, streaming, workspace — not model counts). */
export function setStatus(state: StatusState | string, msg: string): void {
  document.getElementById('sDot')!.className = `s-dot ${state}`;
  document.getElementById('sText')!.textContent = msg;
}

/** Default idle success after model list refresh (matches chat loop). */
export function setReadyStatus(): void {
  setStatus('ok', 'Ready');
}

/** Close settings drawer or mobile chat list when Escape is pressed. */
export function dismissOpenLayers(): void {
  closeSubAgentDrawer();
  const drawer = document.getElementById('drawer');
  if (drawer && drawer.classList.contains('open')) {
    closeDrawer();
    return;
  }
  const fileSide = document.getElementById('fileSidebar');
  if (fileSide && fileSide.classList.contains('mobile-open')) {
    closeMobileFileSidebar();
    return;
  }
  const side = document.getElementById('chatSidebar');
  if (side && side.classList.contains('mobile-open')) {
    closeMobileSidebar();
  }
}
