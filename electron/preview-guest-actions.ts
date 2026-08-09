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

const PREVIEW_CAPTURE_MAX_RETRIES = 3;
const PREVIEW_LOAD_POLL_MS = 50;
const PREVIEW_LOAD_MAX_WAIT_MS = 3_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the guest stops navigating (bounded poll). */
export async function waitForPreviewGuestNotLoading(
  wc: WebContents,
  maxWaitMs = PREVIEW_LOAD_MAX_WAIT_MS,
): Promise<void> {
  if (wc.isDestroyed()) return;
  const start = Date.now();
  while (wc.isLoading()) {
    if (Date.now() - start >= maxWaitMs) break;
    await delay(PREVIEW_LOAD_POLL_MS);
  }
}

/** Two animation frames in the guest document so layout/paint can settle before capture. */
export async function waitForPreviewGuestDoubleRaf(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  try {
    await wc.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true,
    );
  } catch {
    /* no document yet — capture may still succeed */
  }
}

function formatGuestThrownValue(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as Error).message === 'string') {
    const message = (err as Error).message;
    const stack = 'stack' in err && typeof (err as Error).stack === 'string' ? (err as Error).stack : '';
    if (stack && stack.includes(message)) return stack;
    if (stack) return `${message}\n${stack}`;
    return message;
  }
  return String(err);
}

/**
 * Wrap user code for `executeJavaScript`. Uses `eval` on a JSON-encoded string so statements,
 * quotes, and newlines do not break the host wrapper; async results and rejections are awaited.
 */
export function wrapPreviewGuestUserCode(code: string): string {
  const encoded = JSON.stringify(code);
  return `(async function(){
    try {
      const __v = await (0, eval)(${encoded});
      return __v;
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (e && e.stack && typeof e.stack === 'string') {
        if (e.stack.indexOf(msg) !== -1) return { __execError: e.stack };
        return { __execError: msg + '\\n' + e.stack };
      }
      return { __execError: msg };
    }
  })()`;
}

/** Run JavaScript in the preview guest page context. */
export async function previewExecJs(wc: WebContents, code: string): Promise<unknown> {
  try {
    return await wc.executeJavaScript(wrapPreviewGuestUserCode(code), true);
  } catch (err) {
    return { __execError: formatGuestThrownValue(err) };
  }
}

/** Capture the preview guest as a base64-encoded PNG (waits for load, retries empty frames). */
export async function previewCapturePageBase64(wc: WebContents): Promise<string> {
  if (wc.isDestroyed()) return '';

  await waitForPreviewGuestNotLoading(wc);
  await waitForPreviewGuestDoubleRaf(wc);

  for (let attempt = 0; attempt < PREVIEW_CAPTURE_MAX_RETRIES; attempt++) {
    const image = await wc.capturePage();
    const png = image.toPNG();
    const b64 = png.length > 0 ? png.toString('base64') : '';
    if (b64.trim()) return b64;
    if (attempt < PREVIEW_CAPTURE_MAX_RETRIES - 1) {
      await waitForPreviewGuestDoubleRaf(wc);
      await delay(PREVIEW_LOAD_POLL_MS);
    }
  }
  return '';
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
