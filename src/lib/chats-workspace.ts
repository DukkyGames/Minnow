/**
 * Client helper for the ~/.minnow/chats sandbox (MinnowOS Chat App).
 */

import { normalizeWorkspacePath } from './normalize-workspace-path';

export interface ChatsWorkspaceInfo {
  ok?: boolean;
  path: string;
  fileCount: number;
  error?: string;
}

let cachedChatsWorkspacePath: string | null = null;

/** Clear cached chats workspace path (tests or server restart). */
export function resetChatsWorkspacePathCache(): void {
  cachedChatsWorkspacePath = null;
}

/** Cached absolute chats workspace path from the last successful API fetch. */
export function getCachedChatsWorkspacePath(): string | null {
  return cachedChatsWorkspacePath;
}

/** True when a chat or tool workspace path is the chats sandbox. */
export function isChatsWorkspacePath(
  workspacePath: string,
  chatsWorkspacePath?: string | null,
): boolean {
  const chatsPath = chatsWorkspacePath ?? cachedChatsWorkspacePath;
  if (!chatsPath) return false;
  return normalizeWorkspacePath(workspacePath) === normalizeWorkspacePath(chatsPath);
}

/**
 * Fetch chats workspace metadata from GET /api/chats-workspace.
 * Caches the absolute path for subsequent calls.
 */
export async function getChatsWorkspacePath(): Promise<string | null> {
  if (cachedChatsWorkspacePath) {
    return cachedChatsWorkspacePath;
  }

  try {
    const res = await fetch('/api/chats-workspace', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as ChatsWorkspaceInfo;
    if (!data?.path || typeof data.path !== 'string') return null;
    cachedChatsWorkspacePath = data.path;
    return cachedChatsWorkspacePath;
  } catch {
    return null;
  }
}

/** Fetch full chats workspace health payload (path + fileCount). */
export async function fetchChatsWorkspaceInfo(): Promise<ChatsWorkspaceInfo | null> {
  try {
    const res = await fetch('/api/chats-workspace', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as ChatsWorkspaceInfo;
    if (data?.path && typeof data.path === 'string') {
      cachedChatsWorkspacePath = data.path;
    }
    return data;
  } catch {
    return null;
  }
}

export interface ChatsWorkspaceListEntry {
  name: string;
  path: string;
  relativePath: string;
  kind: 'file' | 'directory';
  size?: number;
}

export interface ChatsWorkspaceListResponse {
  ok?: boolean;
  path: string;
  relativePath: string;
  parent: string | null;
  entries: ChatsWorkspaceListEntry[];
  error?: string;
}

async function parseChatsWorkspaceApiError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    /* fall through */
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** List one directory under the chats workspace (GET /api/chats-workspace/list). */
export async function listChatsWorkspaceFiles(
  relativePath = '',
): Promise<ChatsWorkspaceListResponse | null> {
  try {
    const qs =
      relativePath.trim().length > 0
        ? `?path=${encodeURIComponent(relativePath)}`
        : '';
    const res = await fetch(`/api/chats-workspace/list${qs}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ChatsWorkspaceListResponse;
  } catch {
    return null;
  }
}

/** GET /api/chats-workspace/download — triggers a browser download for one file. */
export async function downloadChatsWorkspaceFile(relativePath: string): Promise<true | Error> {
  const trimmed = relativePath.trim();
  if (!trimmed) return new Error('path is required');

  try {
    const res = await fetch(
      `/api/chats-workspace/download?path=${encodeURIComponent(trimmed)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return new Error(await parseChatsWorkspaceApiError(res));

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
