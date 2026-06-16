/**
 * Browser client for /api/brain/* when npm start is running.
 */

import { detectLocalServer } from '../tools/client';
import type {
  BrainIngestResult,
  BrainLintReport,
  BrainPage,
  BrainStatus,
  BrainTreeNode,
} from './types';

const API_BASE = '';

async function brainFetch<T>(
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

/** Ping brain API. */
export async function pingBrainApi(): Promise<boolean> {
  const data = await brainFetch<{ ok: boolean }>('/api/brain/ping');
  return data?.ok === true;
}

/** Wiki store status. */
export async function fetchBrainStatus(): Promise<BrainStatus | null> {
  return brainFetch<BrainStatus>('/api/brain/status');
}

/** Nested folder tree of wiki pages. */
export async function fetchBrainTree(): Promise<BrainTreeNode | null> {
  const data = await brainFetch<{ tree: BrainTreeNode }>('/api/brain/tree');
  return data?.tree ?? null;
}

/** Read one wiki page by relative path (e.g. facts/slug.md). */
export async function fetchBrainPage(relPath: string): Promise<BrainPage | null> {
  const qs = new URLSearchParams({ path: relPath });
  return brainFetch<BrainPage>(`/api/brain/page?${qs}`);
}

/** Create or update a wiki page. */
export async function saveBrainPage(input: {
  path: string;
  title?: string;
  body?: string;
  tags?: string[];
  source?: string;
  summary?: string;
  pinned?: boolean;
}): Promise<BrainPage | null> {
  return brainFetch<BrainPage>('/api/brain/page', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** Read log.md changelog. */
export async function fetchBrainLog(): Promise<string | null> {
  const data = await brainFetch<{ log: string }>('/api/brain/log');
  if (!data) return null;
  return data.log ?? '';
}

/** Read schema.md. */
export async function fetchBrainSchema(): Promise<string | null> {
  const data = await brainFetch<{ schema: string }>('/api/brain/schema');
  if (!data) return null;
  return data.schema ?? '';
}

/** Write schema.md. */
export async function saveBrainSchema(schema: string): Promise<boolean> {
  const data = await brainFetch<{ ok: boolean }>('/api/brain/schema', {
    method: 'PUT',
    body: JSON.stringify({ schema }),
  });
  return data?.ok === true;
}

/** Ingest raw source text into synthesized wiki pages. */
export async function ingestBrainSource(input: {
  content: string;
  filename?: string;
  title?: string;
}): Promise<BrainIngestResult | null> {
  return brainFetch<BrainIngestResult>('/api/brain/ingest', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Run wiki health lint (orphans, stale, broken links). */
export async function lintBrainWiki(options?: {
  includeLlm?: boolean;
}): Promise<BrainLintReport | null> {
  return brainFetch<BrainLintReport>('/api/brain/lint', {
    method: 'POST',
    body: JSON.stringify({ includeLlm: options?.includeLlm !== false }),
  });
}
