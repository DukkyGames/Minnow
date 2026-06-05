/**
 * servers.json — managed local servers (enabled, autoStart, port).
 * Mirrors server/config/validators.js normalizeServersConfig defaults.
 */

/** Managed server ids (catalog). */
export type ManagedServerId = 'searxng';

export interface ManagedServerEntryConfig {
  enabled: boolean;
  autoStart: boolean;
  port: number;
}

export type ServersConfig = Record<ManagedServerId, ManagedServerEntryConfig>;

export const DEFAULT_SERVERS_CONFIG: ServersConfig = {
  searxng: {
    enabled: false,
    autoStart: true,
    port: 8899,
  },
};

let cachedServers: ServersConfig | null = null;

/** Clear in-memory cache (tests). */
export function resetServersConfigCache(): void {
  cachedServers = null;
}

/** GET /api/config/servers (cached until reset). */
export async function loadServersConfig(): Promise<ServersConfig> {
  if (cachedServers) return cachedServers;
  try {
    const res = await fetch('/api/config/servers', { cache: 'no-store' });
    if (!res.ok) {
      return { ...DEFAULT_SERVERS_CONFIG };
    }
    const data = (await res.json()) as Partial<ServersConfig>;
    cachedServers = {
      searxng: { ...DEFAULT_SERVERS_CONFIG.searxng, ...data.searxng },
    };
    return cachedServers;
  } catch {
    return { ...DEFAULT_SERVERS_CONFIG };
  }
}
