/**
 * Browser client for /api/memory/* when npm start is running.
 */

import { detectLocalServer } from '../tools/client';
import type { MemoryEntryMeta, MemoryRetrieveResult } from './types';
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

/** Retrieve formatted memory block for prompt injection. */
export async function retrieveMemoryBlock(options: {
  query?: string;
  profile?: PromptProfile;
  limit?: number;
}): Promise<string> {
  const enabled = await fetchMemoryEnabled();
  if (!enabled) return '';

  const data = await memoryFetch<MemoryRetrieveResult>('/api/memory/retrieve', {
    method: 'POST',
    body: JSON.stringify({
      query: options.query ?? '',
      profile: options.profile ?? 'full',
      limit: options.limit ?? 8,
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
