/**
 * Browser client for LSP config and status (npm start required).
 */

import { detectLocalServer } from '../tools/client';

/** Single server row from GET /api/config/lsp */
export interface LspServerStatus {
  id: string;
  label: string;
  disabled: boolean;
  running: boolean;
  extensions: string[];
  builtin: boolean;
  hasCommand: boolean;
}

/** Merged LSP config from GET /api/config/lsp */
export interface LspConfigResponse {
  enabled: boolean;
  lsp: Record<string, LspServerConfig>;
  servers: LspServerStatus[];
}

/** Per-server config shape in ~/.minnow/lsp.json */
export interface LspServerConfig {
  disabled?: boolean;
  command?: string[];
  extensions?: string[];
  label?: string;
  env?: Record<string, string>;
  initialization?: Record<string, unknown>;
}

/** Partial update for PUT /api/config/lsp */
export interface LspConfigPatch {
  enabled?: boolean;
  lsp?: Record<string, LspServerConfig>;
  removeLspIds?: string[];
}

async function lspFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
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

/** Load merged LSP config and server status list. */
export async function fetchLspConfig(): Promise<LspConfigResponse | null> {
  return lspFetch<LspConfigResponse>('/api/config/lsp');
}

/** Persist partial user overrides to ~/.minnow/lsp.json */
export async function saveLspConfig(patch: LspConfigPatch): Promise<boolean> {
  const ok = await detectLocalServer();
  if (!ok) return false;
  try {
    const res = await fetch('/api/config/lsp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Lightweight status poll (master switch + running flags). */
export async function fetchLspStatus(): Promise<{
  enabled: boolean;
  servers: LspServerStatus[];
} | null> {
  return lspFetch<{ enabled: boolean; servers: LspServerStatus[] }>(
    '/api/lsp/status',
  );
}
