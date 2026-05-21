/**
 * Client access to ~/.minnow provider registry via /api/providers.
 */

import { isServerStorageMode } from '../config/storage-mode';
import { parseServerBaseUrl, serverUrl } from '../ui/status';
import type { ProviderListResponse, ProviderPublic } from './types';

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

/** Clear cached list after external changes. */
export function invalidateProviderCache(): void {
  cachedList = null;
}

/** Last cached list (if any). */
export function getCachedProviderList(): ProviderListResponse | null {
  return cachedList;
}
