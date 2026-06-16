/**
 * Browser client for /api/brain/* when npm start is running.
 */

import { detectLocalServer } from '../tools/client';
import type {
  BrainCodeCallsOfResult,
  BrainCodeConfig,
  BrainCodeExplainResult,
  BrainCodeFindResult,
  BrainCodeGitHookInstallResult,
  BrainCodeGitHookStatus,
  BrainCodeReadSymbolResult,
  BrainCodeReindexResult,
  BrainCodeRepoMap,
  BrainCodeStatus,
  BrainCodeWhoCallsResult,
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

/** Code index status for the active workspace. */
export async function fetchBrainCodeStatus(): Promise<BrainCodeStatus | null> {
  return brainFetch<BrainCodeStatus>('/api/brain/code/status');
}

/** Load config.brain.code settings. */
export async function fetchBrainCodeConfig(): Promise<BrainCodeConfig | null> {
  const data = await brainFetch<{ code: BrainCodeConfig }>('/api/brain/code/config');
  return data?.code ?? null;
}

/** Persist partial config.brain.code settings. */
export async function saveBrainCodeConfig(
  partial: Partial<BrainCodeConfig>,
): Promise<BrainCodeConfig | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
  try {
    const res = await fetch(`${API_BASE}/api/brain/code/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { code: BrainCodeConfig };
    return data.code ?? null;
  } catch {
    return null;
  }
}

/** Reindex the workspace code graph through the cascade engine. */
export async function reindexBrainCode(): Promise<BrainCodeReindexResult | null> {
  return brainFetch<BrainCodeReindexResult>('/api/brain/code/reindex', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Install the optional git post-commit cascade hook in the active workspace. */
export async function installBrainGitHook(): Promise<BrainCodeGitHookInstallResult | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
  try {
    const res = await fetch(`${API_BASE}/api/brain/code/git-hook/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as BrainCodeGitHookInstallResult;
    if (!res.ok) {
      return { installed: false, error: body.error ?? `Install failed (${res.status})` };
    }
    return body;
  } catch {
    return null;
  }
}

/** Remove the Minnow block from the workspace post-commit hook. */
export async function uninstallBrainGitHook(): Promise<{ ok: boolean; removed: boolean } | null> {
  return brainFetch<{ ok: boolean; removed: boolean }>('/api/brain/code/git-hook/uninstall', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Report whether the git post-commit hook is installed. */
export async function fetchBrainGitHookStatus(): Promise<BrainCodeGitHookStatus | null> {
  return brainFetch<BrainCodeGitHookStatus>('/api/brain/code/git-hook/status');
}

/** Token-budgeted signature repo map. */
export async function fetchBrainCodeRepoMap(options?: {
  focus?: string;
  tokenBudget?: number;
}): Promise<BrainCodeRepoMap | null> {
  const qs = new URLSearchParams();
  if (options?.focus?.trim()) qs.set('focus', options.focus.trim());
  if (options?.tokenBudget && options.tokenBudget > 0) {
    qs.set('tokenBudget', String(options.tokenBudget));
  }
  const suffix = qs.toString() ? `?${qs}` : '';
  return brainFetch<BrainCodeRepoMap>(`/api/brain/code/repo-map${suffix}`);
}

/** FTS5 + LSP symbol search. */
export async function findBrainCodeSymbol(
  query: string,
  limit = 20,
): Promise<BrainCodeFindResult | null> {
  const qs = new URLSearchParams({
    query: query.trim(),
    limit: String(limit),
  });
  return brainFetch<BrainCodeFindResult>(`/api/brain/code/find-symbol?${qs}`);
}

/** Incoming call edges for a symbol. */
export async function fetchBrainCodeWhoCalls(
  symbol: string,
): Promise<BrainCodeWhoCallsResult | null> {
  const qs = new URLSearchParams({ symbol });
  return brainFetch<BrainCodeWhoCallsResult>(`/api/brain/code/who-calls?${qs}`);
}

/** Outgoing call edges for a symbol. */
export async function fetchBrainCodeCallsOf(
  symbol: string,
): Promise<BrainCodeCallsOfResult | null> {
  const qs = new URLSearchParams({ symbol });
  return brainFetch<BrainCodeCallsOfResult>(`/api/brain/code/calls-of?${qs}`);
}

/** Read the live source span for a symbol. */
export async function fetchBrainCodeReadSymbol(
  symbol: string,
): Promise<BrainCodeReadSymbolResult | null> {
  const qs = new URLSearchParams({ symbol });
  return brainFetch<BrainCodeReadSymbolResult>(`/api/brain/code/read-symbol?${qs}`);
}

/** Wiki pages that anchor a symbol (code → meaning). */
export async function fetchBrainCodeExplain(
  symbol: string,
): Promise<BrainCodeExplainResult | null> {
  const qs = new URLSearchParams({ symbol });
  return brainFetch<BrainCodeExplainResult>(`/api/brain/code/explain?${qs}`);
}
