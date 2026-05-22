/**
 * Client access to ~/.minnow provider registry via /api/providers.
 */

import { isServerStorageMode } from '../config/storage-mode';
import { parseServerBaseUrl, serverUrl } from '../ui/status';
import type {
  ApiKind,
  AuthStyle,
  ProviderListResponse,
  ProviderPublic,
} from './types';

/** Body for POST /api/providers. */
export interface CreateProviderPayload {
  id: string;
  label: string;
  baseUrl: string;
  apiKind?: ApiKind;
  authStyle?: AuthStyle;
  enabled?: boolean;
  modelsPath?: string;
  chatCompletionsPath?: string;
}

/** Body for PUT /api/providers/:id (id is not mutable). */
export interface UpdateProviderPayload {
  label?: string;
  baseUrl?: string;
  apiKind?: ApiKind;
  authStyle?: AuthStyle;
  enabled?: boolean;
  modelsPath?: string;
  chatCompletionsPath?: string;
}

const PROVIDERS_TIMEOUT_MS = 800;

let cachedList: ProviderListResponse | null = null;
let providersAvailable = false;

/** Whether /api/providers was reachable (npm start). */
export function isProvidersApiAvailable(): boolean {
  return providersAvailable;
}

/** Vite-only fallback: direct LM Studio from settings URL field. */
export function getViteOnlyFallbackProvider(): ProviderPublic {
  const raw = serverUrl() || 'http://localhost:1234';
  const baseUrl = parseServerBaseUrl(raw) || 'http://localhost:1234';
  return {
    id: 'vite-fallback',
    label: 'LM Studio (local)',
    baseUrl,
    apiKind: 'lm-studio-v0',
    enabled: true,
    hasApiKey: false,
    hasBearer: false,
  };
}

async function fetchProvidersList(): Promise<ProviderListResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDERS_TIMEOUT_MS);
  try {
    const res = await fetch('/api/providers', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    providersAvailable = true;
    const data = (await res.json()) as ProviderListResponse;
    cachedList = data;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Load provider list from server or synthesize fallback. */
export async function listProviders(): Promise<ProviderListResponse> {
  if (!isServerStorageMode()) {
    const provider = getViteOnlyFallbackProvider();
    return { providers: [provider], activeProviderId: provider.id };
  }

  try {
    return await fetchProvidersList();
  } catch {
    providersAvailable = false;
    const provider = getViteOnlyFallbackProvider();
    return { providers: [provider], activeProviderId: provider.id };
  }
}

/** Active provider for model fetch and chat (respects per-chat override when set). */
export async function getActiveProvider(chatProviderId?: string): Promise<ProviderPublic> {
  const { providers, activeProviderId } = await listProviders();
  const enabled = providers.filter((p) => p.enabled !== false);
  const targetId = chatProviderId || activeProviderId;
  const found = enabled.find((p) => p.id === targetId);
  if (found) return found;
  if (enabled.length > 0) return enabled[0];
  return getViteOnlyFallbackProvider();
}

/** POST set-active on server; no-op in Vite-only mode. */
export async function setActiveProvider(id: string): Promise<void> {
  if (!isServerStorageMode() || !providersAvailable) {
    return;
  }

  const res = await fetch(`/api/providers/${encodeURIComponent(id)}/set-active`, {
    method: 'POST',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to set active provider: HTTP ${res.status}`);
  }
  cachedList = null;
}

/** PUT /api/providers/:id — update profile fields (not secrets). */
export async function updateProvider(
  id: string,
  payload: UpdateProviderPayload,
): Promise<{ ok: true; provider: ProviderPublic } | { ok: false; error: string }> {
  if (!isServerStorageMode()) {
    return { ok: false, error: 'Provider registry requires npm start' };
  }
  try {
    const res = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const body = (await res.json()) as ProviderPublic & { error?: string };
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Failed to update provider (HTTP ${res.status})` };
    }
    invalidateProviderCache();
    providersAvailable = true;
    return { ok: true, provider: body };
  } catch {
    return { ok: false, error: 'Network error — use npm start' };
  }
}

/** POST /api/providers — register a new LLM backend. */
export async function createProvider(
  payload: CreateProviderPayload,
): Promise<{ ok: true; provider: ProviderPublic } | { ok: false; error: string }> {
  if (!isServerStorageMode()) {
    return { ok: false, error: 'Provider registry requires npm start' };
  }
  try {
    const res = await fetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const body = (await res.json()) as ProviderPublic & { error?: string };
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Failed to add provider (HTTP ${res.status})` };
    }
    invalidateProviderCache();
    providersAvailable = true;
    return { ok: true, provider: body };
  } catch {
    return { ok: false, error: 'Network error — use npm start' };
  }
}

/** DELETE /api/providers/:id (409 when last provider). */
export async function deleteProvider(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isServerStorageMode() || !providersAvailable) {
    return { ok: false, error: 'Provider registry requires npm start' };
  }
  try {
    const res = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    if (res.status === 204) {
      invalidateProviderCache();
      return { ok: true };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: body.error ?? `Failed to remove provider (HTTP ${res.status})`,
    };
  } catch {
    return { ok: false, error: 'Network error — use npm start' };
  }
}

/** PUT /api/providers/:id/secrets — API key / bearer (never echoed on GET). */
export async function updateProviderSecrets(
  id: string,
  secrets: { apiKey?: string; bearerToken?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isServerStorageMode() || !providersAvailable) {
    return { ok: false, error: 'Provider registry requires npm start' };
  }
  try {
    const res = await fetch(`/api/providers/${encodeURIComponent(id)}/secrets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secrets),
      cache: 'no-store',
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Failed to save secrets (HTTP ${res.status})` };
    }
    invalidateProviderCache();
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error — use npm start' };
  }
}

/** Clear cached list after external changes. */
export function invalidateProviderCache(): void {
  cachedList = null;
}

/** Last cached list (if any). */
export function getCachedProviderList(): ProviderListResponse | null {
  return cachedList;
}
