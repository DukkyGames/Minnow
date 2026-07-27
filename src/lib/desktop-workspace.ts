/**
 * Client helper for the desktop chat workspace (Minnow desktop surface).
 */

import { normalizeWorkspacePath } from './normalize-workspace-path';

export interface DesktopWorkspaceInfo {
  ok?: boolean;
  path: string;
  label?: string;
  fileCount: number;
  error?: string;
}

let cachedDesktopWorkspacePath: string | null = null;
let cachedDesktopWorkspaceLabel: string | null = null;

/** Clear cached desktop workspace path (tests or server restart). */
export function resetDesktopWorkspacePathCache(): void {
  cachedDesktopWorkspacePath = null;
  cachedDesktopWorkspaceLabel = null;
}

/** Cached absolute desktop workspace path from the last successful API fetch. */
export function getCachedDesktopWorkspacePath(): string | null {
  return cachedDesktopWorkspacePath;
}

/** Cached folder label from the last successful API fetch. */
export function getCachedDesktopWorkspaceLabel(): string | null {
  return cachedDesktopWorkspaceLabel;
}

/** True when a chat or tool workspace path is the desktop sandbox. */
export function isDesktopWorkspacePath(
  workspacePath: string,
  desktopWorkspacePath?: string | null,
): boolean {
  const desktopPath = desktopWorkspacePath ?? cachedDesktopWorkspacePath;
  if (!desktopPath) return false;
  return normalizeWorkspacePath(workspacePath) === normalizeWorkspacePath(desktopPath);
}

function applyDesktopWorkspaceInfo(data: DesktopWorkspaceInfo): string | null {
  if (!data?.path || typeof data.path !== 'string') return null;
  cachedDesktopWorkspacePath = data.path;
  cachedDesktopWorkspaceLabel =
    typeof data.label === 'string' && data.label.trim()
      ? data.label.trim()
      : data.path.split(/[/\\]/).filter(Boolean).pop() ?? data.path;
  return cachedDesktopWorkspacePath;
}

/**
 * Fetch desktop workspace metadata from GET /api/desktop-workspace.
 * Caches the absolute path for subsequent calls.
 */
export async function getDesktopWorkspacePath(): Promise<string | null> {
  if (cachedDesktopWorkspacePath) {
    return cachedDesktopWorkspacePath;
  }

  try {
    const res = await fetch('/api/desktop-workspace', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as DesktopWorkspaceInfo;
    return applyDesktopWorkspaceInfo(data);
  } catch {
    return null;
  }
}

/** Fetch full desktop workspace health payload (path + fileCount). */
export async function fetchDesktopWorkspaceInfo(): Promise<DesktopWorkspaceInfo | null> {
  try {
    const res = await fetch('/api/desktop-workspace', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as DesktopWorkspaceInfo;
    applyDesktopWorkspaceInfo(data);
    return data;
  } catch {
    return null;
  }
}

/** Set the desktop chat workspace folder (validated on server). */
export async function setDesktopWorkspacePath(absPath: string): Promise<DesktopWorkspaceInfo> {
  const res = await fetch('/api/desktop-workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: absPath }),
  });
  const json = (await res.json()) as DesktopWorkspaceInfo & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  applyDesktopWorkspaceInfo(json);
  return json;
}

export interface DesktopWorkspaceListEntry {
  name: string;
  path: string;
  relativePath: string;
  kind: 'file' | 'directory';
  size?: number;
}

export interface DesktopWorkspaceListResponse {
  ok?: boolean;
  path: string;
  relativePath: string;
  parent: string | null;
  entries: DesktopWorkspaceListEntry[];
  error?: string;
}

async function parseDesktopWorkspaceApiError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    /* fall through */
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** List one directory under the desktop workspace (GET /api/desktop-workspace/list). */
export async function listDesktopWorkspaceFiles(
  relativePath = '',
): Promise<DesktopWorkspaceListResponse | null> {
  try {
    const qs =
      relativePath.trim().length > 0
        ? `?path=${encodeURIComponent(relativePath)}`
        : '';
    const res = await fetch(`/api/desktop-workspace/list${qs}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as DesktopWorkspaceListResponse;
  } catch {
    return null;
  }
}

/** GET /api/desktop-workspace/download — triggers a browser download for one file. */
export async function downloadDesktopWorkspaceFile(relativePath: string): Promise<true | Error> {
  const trimmed = relativePath.trim();
  if (!trimmed) return new Error('path is required');

  try {
    const res = await fetch(
      `/api/desktop-workspace/download?path=${encodeURIComponent(trimmed)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return new Error(await parseDesktopWorkspaceApiError(res));

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? trimmed.split('/').pop() ?? 'download';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}
