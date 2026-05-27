import { parseServerBaseUrl as parseServerBaseUrlImpl } from '../lib/parse-server-base-url';
import { closeMobileFileSidebar } from './file-layout';
import { closeMobileSidebar } from './layout';
import { closeModelSelectMenu } from './model-select-picker';
import { closeSubAgentDrawer } from './sub-agent-drawer';

/** Legacy settings field; when #serverUrl is absent, default LM Studio port for Vite-only mode. */
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
  return parseServerBaseUrlImpl(raw);
}

/** Topbar pill states — operational feedback only, not model inventory. */
export type StatusState = 'idle' | 'ok' | 'err' | 'spin';

/** Update the topbar status pill (connection, streaming, workspace — not model counts). */
export function setStatus(state: StatusState | string, msg: string): void {
  const dot = document.getElementById('sDot');
  const text = document.getElementById('sText');
  if (!dot || !text) return;
  dot.className = `s-dot ${state}`;
  text.textContent = msg;
  const trimmed = msg.trim();
  if (trimmed.length > 24) {
    text.setAttribute('title', trimmed);
  } else {
    text.removeAttribute('title');
  }
}

/** Default idle success after model list refresh (matches chat loop). */
export function setReadyStatus(): void {
  setStatus('ok', 'Ready');
}

/** Close settings drawer or mobile chat list when Escape is pressed. */
export function dismissOpenLayers(): void {
  closeModelSelectMenu();
  closeSubAgentDrawer();
  const drawer = document.getElementById('drawer');
  if (drawer && drawer.classList.contains('open')) {
    void import('./settings').then(({ closeDrawer }) => closeDrawer());
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
