/**
 * Browser client for /api/memory/* when npm start is running.
 */

import { detectLocalServer } from '../tools/client';
import { brainWorkspaceKeyFromPath } from '../lib/brain-workspace-key';
import { getWorkspacePath } from '../state/workspace';
import type {
  MemoryEntryMeta,
  MemoryEntryWithBody,
  MemoryRetrieveResult,
  MemoryEmbeddingsStatus,
  MemoryEmbeddingsReindexResult,
  MemoryEmbeddingsConfig,
} from './types';
import type { PromptProfile } from '../chat/prompts/types';

const API_BASE = '';

async function memoryFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
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

/** Ping memory API. */
export async function pingMemoryApi(): Promise<boolean> {
  const data = await memoryFetch<{ ok: boolean }>('/api/memory/ping');
  return data?.ok === true;
}

export interface MemoryStatus {
  enabled: boolean;
  entryCount: number;
  home: string;
}

/** List memory entries (metadata only unless includeBody). */
export async function fetchMemoryEntries(
  includeBody = true,
): Promise<MemoryEntryWithBody[] | null> {
  const qs = includeBody ? '?includeBody=1' : '';
  const data = await memoryFetch<{ entries: MemoryEntryWithBody[] }>(
    `/api/memory/entries${qs}`,
  );
  if (!data?.entries) return null;
  return data.entries;
}

/** Delete one memory entry by id. */
export async function deleteMemoryEntry(id: string): Promise<boolean> {
  const ok = await detectLocalServer();
  if (!ok) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/memory/entries/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Server memory status (enabled flag, entry count, home path). */
export async function fetchMemoryStatus(): Promise<MemoryStatus | null> {
  const data = await memoryFetch<MemoryStatus>('/api/memory/status');
  if (!data) return null;
  return {
    enabled: data.enabled !== false,
    entryCount: typeof data.entryCount === 'number' ? data.entryCount : 0,
    home: data.home ?? '',
  };
}

/** Whether memory is enabled globally (from server config). */
export async function fetchMemoryEnabled(): Promise<boolean> {
  const status = await fetchMemoryStatus();
  return status?.enabled !== false;
}

/** Retrieve formatted memory block for prompt injection (via Brain wiki retrieve). */
export async function retrieveMemoryBlock(options: {
  query?: string;
  profile?: PromptProfile;
  limit?: number;
}): Promise<string> {
  const enabled = await fetchMemoryEnabled();
  if (!enabled) return '';

  const workspaceKey = brainWorkspaceKeyFromPath(getWorkspacePath());

  const data = await memoryFetch<MemoryRetrieveResult>('/api/brain/retrieve', {
    method: 'POST',
    body: JSON.stringify({
      query: options.query ?? '',
      profile: options.profile ?? 'full',
      limit: options.limit ?? 8,
      workspaceKey,
    }),
  });
  return data?.block?.trim() ?? '';
}

/** Create a memory entry (settings / agent use). */
export async function createMemoryEntry(input: {
  title: string;
  body: string;
  tags?: string[];
  source?: 'user' | 'agent' | 'self-heal';
}): Promise<MemoryEntryMeta | null> {
  const data = await memoryFetch<{ entry: MemoryEntryMeta }>('/api/memory/entries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data?.entry ?? null;
}

/** Clear all memory entries. */
export async function clearMemory(archive = true): Promise<boolean> {
  const data = await memoryFetch<{ removed: number }>('/api/memory/clear', {
    method: 'POST',
    body: JSON.stringify({ archive }),
  });
  return data != null;
}

/** Backup memory store. */
export async function backupMemory(): Promise<string | null> {
  const data = await memoryFetch<{ backupId: string }>('/api/memory/backup', {
    method: 'POST',
    body: '{}',
  });
  return data?.backupId ?? null;
}

/** Fetch semantic embeddings status for memory vectors. */
export async function fetchMemoryEmbeddingsStatus(): Promise<MemoryEmbeddingsStatus | null> {
  return memoryFetch<MemoryEmbeddingsStatus>('/api/memory/embeddings/status');
}

/** Update memory embeddings settings on the server. */
export async function saveMemoryEmbeddingsConfig(
  partial: Partial<MemoryEmbeddingsConfig>,
): Promise<MemoryEmbeddingsConfig | null> {
  const data = await memoryFetch<{ embeddings: MemoryEmbeddingsConfig }>(
    '/api/memory/embeddings/config',
    {
      method: 'PUT',
      body: JSON.stringify(partial),
    },
  );
  return data?.embeddings ?? null;
}

/** Reindex all memory entry vectors. */
export async function reindexMemoryEmbeddings(): Promise<MemoryEmbeddingsReindexResult | null> {
  return memoryFetch<MemoryEmbeddingsReindexResult>('/api/memory/embeddings/reindex', {
    method: 'POST',
    body: '{}',
  });
}
