/**
 * Client helpers for GET /api/system/network and config.json server.networkAccess.
 */

import {
  MINNOW_DEFAULT_PORT,
  defaultMinnowLocalOrigin,
} from './minnow-port.ts';

export type NetworkAccess = 'local' | 'lan';

export interface NetworkStatus {
  networkAccess: NetworkAccess;
  configNetworkAccess: NetworkAccess;
  port: number;
  localUrl: string;
  lanUrls: string[];
  restartRequired: boolean;
}

const DEFAULT_NETWORK_STATUS: NetworkStatus = {
  networkAccess: 'local',
  configNetworkAccess: 'local',
  port: MINNOW_DEFAULT_PORT,
  localUrl: `${defaultMinnowLocalOrigin()}/`,
  lanUrls: [],
  restartRequired: false,
};

function normalizeMode(value: unknown): NetworkAccess {
  return value === 'lan' ? 'lan' : 'local';
}

/** Fetch live network status from the dev server. */
export async function fetchNetworkStatus(): Promise<NetworkStatus> {
  try {
    const res = await fetch('/api/system/network', { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_NETWORK_STATUS };
    const data = (await res.json()) as Partial<NetworkStatus>;
    return {
      networkAccess: normalizeMode(data.networkAccess),
      configNetworkAccess: normalizeMode(data.configNetworkAccess ?? data.networkAccess),
      port: typeof data.port === 'number' ? data.port : DEFAULT_NETWORK_STATUS.port,
      localUrl:
        typeof data.localUrl === 'string' ? data.localUrl : DEFAULT_NETWORK_STATUS.localUrl,
      lanUrls: Array.isArray(data.lanUrls)
        ? data.lanUrls.filter((u): u is string => typeof u === 'string')
        : [],
      restartRequired: data.restartRequired === true,
    };
  } catch {
    return { ...DEFAULT_NETWORK_STATUS };
  }
}

/** Persist server.networkAccess via PUT /api/config/meta. */
export async function saveNetworkAccess(mode: NetworkAccess): Promise<void> {
  const res = await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server: { networkAccess: mode } }),
  });
  if (!res.ok) {
    throw new Error('Could not save network access setting');
  }
}

/** Read persisted networkAccess from config meta (falls back to local). */
export async function loadConfigNetworkAccess(): Promise<NetworkAccess> {
  try {
    const res = await fetch('/api/config/meta', { cache: 'no-store' });
    if (!res.ok) return 'local';
    const meta = (await res.json()) as { server?: { networkAccess?: unknown } };
    return normalizeMode(meta.server?.networkAccess);
  } catch {
    return 'local';
  }
}
