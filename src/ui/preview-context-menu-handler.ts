/**
 * Wires Electron preview guest context-menu IPC to the DOM menu + action dispatch.
 *
 * Send to chat reuses the Design Mode Select pipeline: CDP resolve → region capture →
 * elementRef composer chip (no auto-send, no panel switch).
 */

import { addElementRefToComposer } from '../attachments/element-ref';
import { captureRegion } from '../design/region-capture';
import type {
  MinnowPreviewContextMenuOpenPayload,
  MinnowPreviewContextMenuRole,
} from '../electron';
import { getFilePanelState } from '../state/file-panel';
import {
  hidePreviewContextMenu,
  type PreviewContextMenuActionItem,
} from './preview-context-menu';
import { openPreviewTabWithCapacity } from './preview-tab-store';
import { showToast } from './toast';

/** Active preview page ref (workspace path or URL) — same as Design Mode chips. */
function currentPreviewPageRef(): string {
  const source = getFilePanelState().previewSource;
  if (!source) return '';
  return source.kind === 'workspace' ? source.path : source.url;
}

let unsubOpen: (() => void) | null = null;
let initialized = false;

/** Optional test hooks so unit tests can stub IPC / composer / capture. */
export interface PreviewContextMenuHandlerHooks {
  resolveElement?: (
    tabId: string,
    x: number,
    y: number,
    instanceId?: string,
  ) => Promise<{
    ok: boolean;
    picked?: {
      uid: number | null;
      cssSelector: string;
      tagName: string;
      classList: string[];
      outerHTMLPreview: string;
      boundingRect: { x: number; y: number; width: number; height: number };
      devicePixelRatio: number;
      stylesDigest: string;
      accessibleName: string;
      contrastRatio: number | null;
      domPath: string;
      attributes: Record<string, string>;
      computedStyles: Record<string, string>;
    };
    pageUrl?: string;
    error?: string;
  }>;
  addElementRef?: typeof addElementRefToComposer;
  captureRegion?: typeof captureRegion;
  openLinkInNewTab?: (url: string) => Promise<void>;
  contextAction?: (
    tabId: string,
    role: MinnowPreviewContextMenuRole,
    payload?: Record<string, unknown>,
    instanceId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  contextInspect?: (
    tabId: string,
    x: number,
    y: number,
    instanceId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

let hooks: PreviewContextMenuHandlerHooks | null = null;

/** Replace action dependencies in unit tests. */
export function setPreviewContextMenuHandlerHooks(
  next: PreviewContextMenuHandlerHooks | null,
): void {
  hooks = next;
}

function getContextMenuApi() {
  return window.minnow?.preview?.contextMenu ?? null;
}

async function openLinkInNewTab(url: string): Promise<void> {
  if (hooks?.openLinkInNewTab) {
    await hooks.openLinkInNewTab(url);
    return;
  }
  const trimmed = url.trim();
  if (!trimmed) return;

  let opened = openPreviewTabWithCapacity({ kind: 'url', url: trimmed });
  if (!opened.tab && opened.evictedId) {
    const { closePreviewTabUi } = await import('./preview-panel');
    await closePreviewTabUi(opened.evictedId);
    opened = openPreviewTabWithCapacity({ kind: 'url', url: trimmed }, { evict: false });
  }
  if (!opened.tab) {
    showToast('Tab limit reached (6 max). Close a tab to open another.', 'error');
    return;
  }

  const { activatePreviewTabGuest } = await import('./preview-panel');
  await activatePreviewTabGuest(opened.tab.id, { forceLoad: true });
}

async function sendElementToChat(
  payload: MinnowPreviewContextMenuOpenPayload,
): Promise<void> {
  const api = getContextMenuApi();
  const resolve =
    hooks?.resolveElement ??
    (api
      ? (tabId: string, x: number, y: number, instanceId?: string) =>
          api.resolveElement(tabId, x, y, instanceId)
      : null);
  if (!resolve) {
    showToast('Send to chat requires the desktop shell', 'error');
    return;
  }

  const result = await resolve(payload.tabId, payload.x, payload.y, payload.instanceId);
  if (!result.ok || !result.picked) {
    showToast(result.error || 'Could not resolve element', 'error');
    return;
  }

  const picked = result.picked;
  const selector =
    picked.cssSelector || (picked.uid != null ? `[data-mn-uid="${picked.uid}"]` : '');
  if (!selector) {
    showToast('Could not resolve element selector', 'error');
    return;
  }

  const capture = hooks?.captureRegion ?? captureRegion;
  const captured = await capture({
    selector,
    boundingRect: picked.boundingRect,
    devicePixelRatio: picked.devicePixelRatio,
  });

  const pageUrl =
    (result.pageUrl && result.pageUrl.trim()) ||
    currentPreviewPageRef() ||
    payload.pageUrl ||
    '';

  const addRef = hooks?.addElementRef ?? addElementRefToComposer;
  const attachment = addRef({
    selector,
    uid: picked.uid,
    pageUrl,
    tagName: picked.tagName,
    classList: picked.classList,
    outerHtmlPreview: picked.outerHTMLPreview,
    rect: picked.boundingRect,
    stylesDigest: picked.stylesDigest,
    croppedDataUrl: captured.dataUrl,
    accessibleName: picked.accessibleName,
    contrastRatio: picked.contrastRatio,
    domPath: picked.domPath,
    attributes: picked.attributes,
    computedStyles: picked.computedStyles,
  });

  if (attachment) {
    showToast('Element added to chat');
  } else {
    showToast('Could not add element to chat', 'error');
  }
}

async function dispatchMenuAction(
  payload: MinnowPreviewContextMenuOpenPayload,
  item: PreviewContextMenuActionItem,
): Promise<void> {
  const role = item.role as MinnowPreviewContextMenuRole;
  const api = getContextMenuApi();

  if (role === 'sendToChat') {
    await sendElementToChat(payload);
    return;
  }

  if (role === 'openLinkInNewTab') {
    await openLinkInNewTab(payload.params.linkURL || '');
    return;
  }

  if (role === 'inspect') {
    const inspect =
      hooks?.contextInspect ??
      (api
        ? (tabId: string, x: number, y: number, instanceId?: string) =>
            api.inspect(tabId, x, y, instanceId)
        : null);
    if (!inspect) {
      showToast('Inspect requires the desktop shell', 'error');
      return;
    }
    const result = await inspect(payload.tabId, payload.x, payload.y, payload.instanceId);
    if (!result.ok) {
      showToast(result.error || 'Inspect failed', 'error');
    }
    return;
  }

  const action =
    hooks?.contextAction ??
    (api
      ? (
          tabId: string,
          actionRole: MinnowPreviewContextMenuRole,
          actionPayload?: Record<string, unknown>,
          instanceId?: string,
        ) => api.action(tabId, actionRole, actionPayload, instanceId)
      : null);
  if (!action) return;

  const result = await action(
    payload.tabId,
    role,
    {
      x: payload.x,
      y: payload.y,
      linkURL: payload.params.linkURL,
      srcURL: payload.params.srcURL,
      suggestion: item.suggestion,
      misspelledWord: payload.params.misspelledWord,
    },
    payload.instanceId,
  );
  if (!result.ok && result.error) {
    showToast(result.error, 'error');
  }
}

function onContextMenuSelect(
  payload: MinnowPreviewContextMenuOpenPayload & {
    role: MinnowPreviewContextMenuRole;
    suggestion?: string;
  },
): void {
  const item: PreviewContextMenuActionItem = {
    role: payload.role,
    label: '',
    enabled: true,
    suggestion: payload.suggestion,
  };
  void dispatchMenuAction(payload, item);
}

/**
 * Subscribe to preview context-menu renderer actions (Send to chat, Open in new tab).
 * The menu itself is shown in the main process at the click position.
 */
export function initPreviewContextMenuHandler(): void {
  if (initialized) return;
  initialized = true;

  const api = getContextMenuApi();
  if (!api?.onSelect) return;

  unsubOpen = api.onSelect(onContextMenuSelect);
}

/** Test helper — tear down subscription and hooks. */
export function resetPreviewContextMenuHandlerForTests(): void {
  unsubOpen?.();
  unsubOpen = null;
  initialized = false;
  hooks = null;
  hidePreviewContextMenu();
}

/** Exposed for unit tests — run Send to chat for a synthetic open payload. */
export async function sendToChatFromContextMenuForTests(
  payload: MinnowPreviewContextMenuOpenPayload,
): Promise<void> {
  await sendElementToChat(payload);
}
