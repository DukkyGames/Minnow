/**
 * Built-in preview browser automation (Electron WebContentsView via window.minnow.preview).
 */

import { loadBrowserMeta } from '../config/browser-meta';
import type { ToolExecutionResult } from '../types';
import {
  PREVIEW_DOM_SNAPSHOT_SCRIPT,
  renderPreviewSnapshotTree,
  type PreviewSnapshotNode,
} from './browser-preview-snapshot';
import {
  isElectronPreviewAvailable,
  isMinnowElectronShell,
  isPreviewAutomationReady,
} from './minnow-shell';

export { isElectronPreviewAvailable } from './minnow-shell';

const DESKTOP_SHELL_MESSAGE =
  'Error: Browser automation runs in the Minnow desktop shell. Use the Minnow app window from npm start or npm run electron:dev — not a separate browser tab.';

const STALE_SHELL_MESSAGE =
  'Error: Browser automation IPC is missing. Quit the app, run npm run electron:build, then restart the desktop shell.';

function previewApi(): NonNullable<Window['minnow']>['preview'] {
  if (!isMinnowElectronShell()) {
    throw new Error(DESKTOP_SHELL_MESSAGE.replace(/^Error: /, ''));
  }
  if (!isPreviewAutomationReady()) {
    throw new Error(STALE_SHELL_MESSAGE.replace(/^Error: /, ''));
  }
  return window.minnow!.preview;
}

async function assertBrowserAutomationEnabled(): Promise<string | null> {
  const meta = await loadBrowserMeta();
  if (!meta.enabled) {
    return 'Error: browser automation is disabled in settings';
  }
  return null;
}

/** Consume a one-time allowlist grant after a successful navigation. */
async function consumeEphemeralNavigationGrant(url: string): Promise<void> {
  try {
    await fetch('/api/browser/allowlist/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    /* best-effort */
  }
}

function formatEvalResult(val: unknown): string {
  if (val === undefined) return '(undefined)';
  if (typeof val === 'object' && val !== null) {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

async function uploadScreenshotBase64(dataBase64: string): Promise<{ id: string; sizeBytes: number }> {
  const res = await fetch('/api/browser/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataBase64 }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `screenshot upload failed (HTTP ${res.status})`);
  }
  return (await res.json()) as { id: string; sizeBytes: number };
}

export async function browserPreviewList(): Promise<string> {
  if (!isElectronPreviewAvailable()) return DESKTOP_SHELL_MESSAGE;
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) return disabled;

  const info = await previewApi().getInfo();
  const title = info.title || '(no title)';
  return `[active] ${title}\n  ${info.url || '(no url)'}`;
}

export async function browserPreviewNavigate(url: string): Promise<string> {
  if (!isElectronPreviewAvailable()) return DESKTOP_SHELL_MESSAGE;
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) return disabled;

  const meta = await loadBrowserMeta();
  if (!meta.allowNavigate) {
    return 'Error: navigation is disabled in settings';
  }

  const api = previewApi();
  await api.show();
  const result = await api.navigateAndWait(url);
  if (!result.ok) {
    const detail = result.errorDescription ?? 'navigation failed';
    return `Error: ${detail}`;
  }

  await consumeEphemeralNavigationGrant(url);
  const title = result.title || '(no title)';
  return `Navigated to: ${result.url}\nTitle: ${title}`;
}

export async function browserPreviewSnapshot(): Promise<string> {
  if (!isElectronPreviewAvailable()) return DESKTOP_SHELL_MESSAGE;
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) return disabled;

  const raw = await previewApi().execJs(PREVIEW_DOM_SNAPSHOT_SCRIPT);
  const payload = raw as { text?: string; nodes?: PreviewSnapshotNode[] };
  if (payload?.text && payload.text !== '(empty page)') {
    return payload.text;
  }

  const fallback = await previewApi().execJs(
    'document.body ? document.body.innerText.slice(0, 3000) : ""',
  );
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback;
  }

  if (payload?.nodes?.length) {
    const rendered = renderPreviewSnapshotTree(payload.nodes);
    if (rendered) return rendered;
  }

  return payload?.text ?? '(empty page)';
}

export async function browserPreviewClick(uid: number): Promise<string> {
  if (!isElectronPreviewAvailable()) return DESKTOP_SHELL_MESSAGE;
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) return disabled;

  const script = `(() => {
    const el = document.querySelector('[data-mn-uid="${uid}"]');
    if (!el) return { missing: true };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name =
      (el.getAttribute('aria-label') || (el.innerText || el.textContent || '').trim()).slice(0, 200);
    if (typeof el.click === 'function') el.click();
    return { missing: false, role, name };
  })()`;

  const raw = await previewApi().execJs(script);
  const result = raw as { missing?: boolean; role?: string; name?: string };
  if (result?.missing) {
    return 'No snapshot cached. Call browser_snapshot first.';
  }
  return `Clicked [${uid}] ${result.role ?? 'element'} "${result.name ?? ''}"`;
}

export async function browserPreviewFill(uid: number, value: string): Promise<string> {
  if (!isElectronPreviewAvailable()) return DESKTOP_SHELL_MESSAGE;
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) return disabled;

  const escaped = JSON.stringify(value);
  const script = `(() => {
    const el = document.querySelector('[data-mn-uid="${uid}"]');
    if (!el) return { missing: true };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.focus();
    if ('value' in el) {
      el.value = ${escaped};
    } else {
      el.textContent = ${escaped};
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { missing: false };
  })()`;

  const raw = await previewApi().execJs(script);
  const result = raw as { missing?: boolean };
  if (result?.missing) {
    return 'No snapshot cached. Call browser_snapshot first.';
  }
  return `Filled [${uid}] with "${value}"`;
}

export async function browserPreviewEval(expression: string): Promise<string> {
  if (!isElectronPreviewAvailable()) return DESKTOP_SHELL_MESSAGE;
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) return disabled;

  try {
    const val = await previewApi().execJs(expression);
    return formatEvalResult(val);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

export async function browserPreviewScreenshot(): Promise<ToolExecutionResult> {
  if (!isElectronPreviewAvailable()) {
    return { content: DESKTOP_SHELL_MESSAGE };
  }
  const disabled = await assertBrowserAutomationEnabled();
  if (disabled) {
    return { content: disabled };
  }

  try {
    const dataBase64 = await previewApi().capturePage();
    const { id, sizeBytes } = await uploadScreenshotBase64(dataBase64);
    const url = `/api/browser/screenshot/${id}`;
    const kb = Math.round(sizeBytes / 1024);
    const text = `Screenshot saved: ${id}.png\nURL: ${url}\n(${kb} KB)`;
    return {
      content: text,
      attachments: [
        {
          type: 'image',
          url,
          mime: 'image/png',
          alt: 'Browser screenshot',
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${message}` };
  }
}

/** Dispatch a built-in preview browser tool by function name. */
export async function executeBrowserPreviewTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case 'browser_list':
        return { content: await browserPreviewList() };
      case 'browser_navigate': {
        const url = args.url;
        if (typeof url !== 'string' || !url.trim()) {
          return { content: 'Error: url is required' };
        }
        return { content: await browserPreviewNavigate(url.trim()) };
      }
      case 'browser_snapshot':
        return { content: await browserPreviewSnapshot() };
      case 'browser_click': {
        const uid = Number(args.uid);
        if (!Number.isFinite(uid)) {
          return { content: 'Error: uid is required' };
        }
        return { content: await browserPreviewClick(uid) };
      }
      case 'browser_fill': {
        const uid = Number(args.uid);
        const value = args.value != null ? String(args.value) : '';
        if (!Number.isFinite(uid)) {
          return { content: 'Error: uid is required' };
        }
        return { content: await browserPreviewFill(uid, value) };
      }
      case 'browser_eval': {
        const expression = args.expression;
        if (typeof expression !== 'string' || !expression.trim()) {
          return { content: 'Error: expression is required' };
        }
        return { content: await browserPreviewEval(expression) };
      }
      case 'browser_screenshot':
        return browserPreviewScreenshot();
      default:
        return { content: `Error: unknown preview browser tool "${name}"` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${message}` };
  }
}
