/**
 * Drag payloads for Code editor tabs and in-app browser tabs → chat link chips (MIN-630).
 *
 * Tab reorder still uses `text/plain` (`file:<path>` / `preview:<id>`). These
 * typed MIMEs are what the chat drop target keys off — `dragover` can see
 * custom types but cannot call `getData`.
 */

/** MIME for a workspace file tab dragged off the unified strip. */
export const VIEWER_TAB_MIME = 'application/x-minnow-viewer-tab';

/** MIME for an in-app browser tab dragged off the unified strip. */
export const PREVIEW_TAB_MIME = 'application/x-minnow-preview-tab';

/** File tab payload written on dragstart. */
export interface ViewerTabDragPayload {
  kind: 'file';
  path: string;
  label: string;
}

/** Browser tab payload: a URL, a workspace preview, or nothing linkable yet. */
export type PreviewTabDragPayload =
  | { kind: 'url'; url: string; label: string }
  | { kind: 'file'; path: string; label: string };

/** Either tab kind after a completed drop. */
export type TabDragPayload = ViewerTabDragPayload | PreviewTabDragPayload;

/**
 * Active tab drag, or null. `dragover` cannot read `getData`, so highlighting
 * keys off this module flag the same way issue capture does.
 */
let activeTabDrag: TabDragPayload | null = null;

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Start a tab drag so chat drop targets can highlight during dragover. */
export function beginTabDrag(payload: TabDragPayload | null): void {
  activeTabDrag = payload;
}

/** Clear the in-flight tab drag (dragend / drop). */
export function endTabDrag(): void {
  activeTabDrag = null;
}

/** Payload recorded on dragstart, or null. */
export function getActiveTabDrag(): TabDragPayload | null {
  return activeTabDrag;
}

/** True while an editor or browser tab is being dragged. */
export function isTabDragActive(): boolean {
  return activeTabDrag !== null;
}

/** True when the transfer (or the in-flight flag) is a tab drag. */
export function hasTabDrag(dataTransfer: DataTransfer | null): boolean {
  if (activeTabDrag) return true;
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types);
  return types.includes(VIEWER_TAB_MIME) || types.includes(PREVIEW_TAB_MIME);
}

/** Encode a file-viewer tab for dragstart (also sets workspace MIME + reorder token). */
export function setViewerTabDragData(
  dataTransfer: DataTransfer,
  input: { path: string; label?: string },
): ViewerTabDragPayload | null {
  const path = input.path.trim().replace(/\\/g, '/');
  if (!path) return null;
  const payload: ViewerTabDragPayload = {
    kind: 'file',
    path,
    label: (input.label ?? basename(path)).trim() || basename(path),
  };
  dataTransfer.setData(VIEWER_TAB_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copyMove';
  beginTabDrag(payload);
  return payload;
}

/** Encode a preview tab for dragstart when it has a URL or workspace source. */
export function setPreviewTabDragData(
  dataTransfer: DataTransfer,
  input: {
    id: string;
    title?: string;
    source?: { kind: 'url'; url: string } | { kind: 'workspace'; path: string } | null;
  },
): PreviewTabDragPayload | null {
  const source = input.source ?? null;
  let payload: PreviewTabDragPayload | null = null;
  if (source?.kind === 'url') {
    const url = source.url.trim();
    if (/^https?:\/\//i.test(url)) {
      payload = {
        kind: 'url',
        url,
        label: (input.title ?? '').trim() || hostnameLabel(url),
      };
    }
  } else if (source?.kind === 'workspace') {
    const path = source.path.trim().replace(/\\/g, '/');
    if (path) {
      payload = {
        kind: 'file',
        path,
        label: (input.title ?? '').trim() || basename(path),
      };
    }
  }
  if (payload) {
    dataTransfer.setData(PREVIEW_TAB_MIME, JSON.stringify(payload));
    dataTransfer.effectAllowed = 'copyMove';
    beginTabDrag(payload);
  } else {
    beginTabDrag(null);
  }
  return payload;
}

function parseTabPayloadJson(raw: string): TabDragPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.kind === 'file') {
    const path = typeof record.path === 'string' ? record.path.trim().replace(/\\/g, '/') : '';
    if (!path) return null;
    const label =
      typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : basename(path);
    return { kind: 'file', path, label };
  }
  if (record.kind === 'url') {
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) return null;
    const label =
      typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : hostnameLabel(url);
    return { kind: 'url', url, label };
  }
  return null;
}

/**
 * Read a tab payload from a completed drop. Prefers typed MIME, then the
 * in-flight flag (some hosts blank custom MIME on drop).
 */
export function parseTabDragData(dataTransfer: DataTransfer | null): TabDragPayload | null {
  if (!dataTransfer) return activeTabDrag;
  const viewerRaw = dataTransfer.getData(VIEWER_TAB_MIME).trim();
  if (viewerRaw) {
    const parsed = parseTabPayloadJson(viewerRaw);
    if (parsed) return parsed;
  }
  const previewRaw = dataTransfer.getData(PREVIEW_TAB_MIME).trim();
  if (previewRaw) {
    const parsed = parseTabPayloadJson(previewRaw);
    if (parsed) return parsed;
  }
  return activeTabDrag;
}

/** Reset module state (tests). */
export function resetTabDragForTests(): void {
  activeTabDrag = null;
}
