/**
 * Browser client for Brain archive API endpoints (MIN-139).
 */

import { detectLocalServer } from '../../tools/client';
import type { ApiMessage } from '../../types';
import type { ArchiveBundleRequest, ArchiveHistoryRange, ArchiveRecallHit } from './types';

export interface ArchiveStatusResponse {
  chatId: string;
  ranges: Array<{
    startIndex: number;
    endIndex: number;
    sourceTurnIndices: number[];
    pagePath?: string;
  }>;
  pending: ArchiveHistoryRange[];
}

export interface ArchiveRetrieveResponse {
  block: string;
  ids: string[];
  hits?: ArchiveRecallHit[];
}

async function archiveFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Fire-and-forget archive bundle request. */
export async function enqueueArchiveBundle(
  request: ArchiveBundleRequest,
): Promise<{ pageIds?: string[]; ranges?: unknown[] } | null> {
  return archiveFetch('/api/brain/archive', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/** Poll which stale ranges have completed bundling. */
export async function fetchArchiveStatus(
  chatId: string,
  workspaceKey: string,
  pending: ArchiveHistoryRange[],
): Promise<ArchiveStatusResponse | null> {
  const params = new URLSearchParams({
    chatId,
    workspaceKey,
    pending: JSON.stringify(pending),
  });
  return archiveFetch<ArchiveStatusResponse>(`/api/brain/archive/status?${params}`);
}

/** Scoped retrieve over a chat's archive folder. */
export async function retrieveChatArchive(
  query: string,
  workspaceKey: string,
  chatId: string,
  topK: number,
): Promise<ArchiveRetrieveResponse | null> {
  return archiveFetch<ArchiveRetrieveResponse>('/api/brain/retrieve', {
    method: 'POST',
    body: JSON.stringify({
      query,
      workspaceKey,
      limit: topK,
      includeHits: true,
      scope: { chatId },
    }),
  });
}

/** Remove a chat's archive folder (fire-and-forget on delete). */
export async function deleteChatArchive(
  chatId: string,
  workspaceKey: string,
): Promise<void> {
  void archiveFetch(
    `/api/brain/archive/chat/${encodeURIComponent(chatId)}?workspaceKey=${encodeURIComponent(workspaceKey)}`,
    { method: 'DELETE' },
  );
}

/** Slice API messages for a history range to send to the bundler. */
export function sliceTurnsForRange(
  messages: ApiMessage[],
  range: ArchiveHistoryRange,
  historyLength: number,
): ApiMessage[] {
  const systemEnd = (() => {
    let n = 0;
    for (const msg of messages) {
      if (msg.role === 'system') n += 1;
      else break;
    }
    return n;
  })();
  const start = systemEnd + range.startIndex;
  const end = systemEnd + range.endIndex;
  if (start < 0 || end > messages.length) {
    return messages.slice(systemEnd, systemEnd + historyLength);
  }
  return messages.slice(start, end);
}
