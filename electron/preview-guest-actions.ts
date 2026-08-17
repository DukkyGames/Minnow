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
/** Bound CopyFromSurface so a hung macOS capture cannot stall IPC / the tool loop. */
export const PREVIEW_CAPTURE_PAGE_TIMEOUT_MS = 3_000;
/**
 * Bound guest `executeJavaScript` (browser_eval and other execJs callers).
 * Matches the default shell-command budget; far below board task-chat stall (~4.5 min).
 */
export const PREVIEW_EXEC_JS_TIMEOUT_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reject if `promise` does not settle within `ms`. Does not cancel the underlying work. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
 * Races a timer so a never-settling Promise cannot pin the guest queue (infinite loops still
 * need the host `withTimeout` — they block the page event loop so this timer never fires).
 */
export function wrapPreviewGuestUserCode(
  code: string,
  timeoutMs: number = PREVIEW_EXEC_JS_TIMEOUT_MS,
): string {
  const encoded = JSON.stringify(code);
  const boundMs = Math.max(1, Math.floor(timeoutMs));
  return `(async function(){
    var __timer;
    try {
      var __run = Promise.resolve().then(function(){ return (0, eval)(${encoded}); });
      var __timeout = new Promise(function(_, reject){
        __timer = setTimeout(function(){
          reject(new Error('preview script timed out after ${boundMs}ms'));
        }, ${boundMs});
      });
      return await Promise.race([__run, __timeout]);
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (e && e.stack && typeof e.stack === 'string') {
        if (e.stack.indexOf(msg) !== -1) return { __execError: e.stack };
        return { __execError: msg + '\\n' + e.stack };
      }
      return { __execError: msg };
    } finally {
      if (__timer) clearTimeout(__timer);
    }
  })()`;
}

export interface PreviewExecJsOptions {
  /** Override the executeJavaScript deadline (tests). */
  timeoutMs?: number;
}

/** Run JavaScript in the preview guest page context. */
export async function previewExecJs(
  wc: WebContents,
  code: string,
  options?: PreviewExecJsOptions,
): Promise<unknown> {
  if (wc.isDestroyed()) {
    return { __execError: 'Preview guest is destroyed' };
  }
  const timeoutMs = options?.timeoutMs ?? PREVIEW_EXEC_JS_TIMEOUT_MS;
  try {
    // Host race covers infinite loops / a wedged renderer; the wrapper race covers
    // Promises that never settle without blocking the guest event loop.
    return await withTimeout(
      wc.executeJavaScript(wrapPreviewGuestUserCode(code, timeoutMs), true),
      timeoutMs,
      `preview executeJavaScript timed out after ${timeoutMs}ms`,
    );
  } catch (err) {
    return { __execError: formatGuestThrownValue(err) };
  }
}

export interface PreviewCapturePageOptions {
  /** Override the CopyFromSurface timeout (tests). */
  captureTimeoutMs?: number;
}

/** Capture the preview guest as a base64-encoded PNG (waits for load, retries empty frames). */
export async function previewCapturePageBase64(
  wc: WebContents,
  options?: PreviewCapturePageOptions,
): Promise<string> {
  if (wc.isDestroyed()) return '';

  const timeoutMs = options?.captureTimeoutMs ?? PREVIEW_CAPTURE_PAGE_TIMEOUT_MS;

  await waitForPreviewGuestNotLoading(wc);
  try {
    await withTimeout(
      waitForPreviewGuestDoubleRaf(wc),
      timeoutMs,
      'preview capture rAF timed out',
    );
  } catch {
    /* guest rAF hung — still try one capture attempt */
  }

  for (let attempt = 0; attempt < PREVIEW_CAPTURE_MAX_RETRIES; attempt++) {
    try {
      const image = await withTimeout(
        wc.capturePage(),
        timeoutMs,
        'preview capturePage timed out',
      );
      const png = image.toPNG();
      const b64 = png.length > 0 ? png.toString('base64') : '';
      if (b64.trim()) return b64;
    } catch {
      // Hung or failed GPU copy — do not retry (retries would stack CopyFromSurface calls).
      return '';
    }
    if (attempt < PREVIEW_CAPTURE_MAX_RETRIES - 1) {
      try {
        await withTimeout(
          waitForPreviewGuestDoubleRaf(wc),
          timeoutMs,
          'preview capture rAF timed out',
        );
      } catch {
        return '';
      }
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
