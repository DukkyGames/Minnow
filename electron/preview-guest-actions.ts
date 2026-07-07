/**
 * Preview guest WebContents helpers (testable without full IPC wiring).
 */

import type { WebContents } from 'electron';

export interface PreviewNavigateAwaitResult {
  ok: boolean;
  url: string;
  title: string;
  errorCode?: number;
  errorDescription?: string;
}

export interface PreviewGuestInfo {
  url: string;
  title: string;
  loading: boolean;
}

/** Run JavaScript in the preview guest page context. */
export async function previewExecJs(wc: WebContents, code: string): Promise<unknown> {
  const wrapped = `(function(){ try { return (${code}); } catch(e) { return { __execError: e && e.message ? e.message : String(e) }; } })()`;
  return wc.executeJavaScript(wrapped, true);
}

/** Capture the preview guest as a base64-encoded PNG. */
export async function previewCapturePageBase64(wc: WebContents): Promise<string> {
  const image = await wc.capturePage();
  return image.toPNG().toString('base64');
}

/** Read current preview guest URL, title, and loading flag. */
export function previewGetGuestInfo(wc: WebContents): PreviewGuestInfo {
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
  };
}

const BLANK_GUEST_URL = 'about:blank';

/** True when Electron aborted a navigation (superseded by a newer load or stop). */
export function isNavigationAbortedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { errno?: number; code?: string; message?: string };
  if (e.errno === -3 || e.code === 'ERR_ABORTED') return true;
  return typeof e.message === 'string' && e.message.includes('ERR_ABORTED');
}

/** Reset the preview guest to an empty page; ignores superseded navigations. */
export async function previewClearGuest(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  const current = wc.getURL();
  if (!wc.isLoading() && (current === BLANK_GUEST_URL || current === '')) {
    return;
  }
  try {
    await wc.loadURL(BLANK_GUEST_URL);
  } catch (err) {
    if (!isNavigationAbortedError(err)) throw err;
  }
}

/** Load a URL in the preview guest and await Electron's loadURL promise. */
export async function previewNavigateAwait(
  wc: WebContents,
  url: string,
): Promise<PreviewNavigateAwaitResult> {
  const target = url.trim();
  if (!target) {
    return {
      ok: false,
      url: '',
      title: '',
      errorDescription: 'url is required',
    };
  }
  try {
    await wc.loadURL(target);
    return {
      ok: true,
      url: wc.getURL(),
      title: wc.getTitle(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      url: target,
      title: wc.getTitle(),
      errorDescription: message,
    };
  }
}
