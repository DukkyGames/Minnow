/**
 * LSP availability for capability-matrix probes (mirrors file viewer + settings gates).
 */

import { fetchLspConfig, type LspServerStatus } from '../../lsp/config-client.ts';

/** At least one non-disabled server that can run (already running or has a launch command). */
export function lspServersUsable(servers: LspServerStatus[]): boolean {
  return servers.some((server) => !server.disabled && (server.running || server.hasCommand));
}

/** Skip reason when LSP probes cannot run; null when the environment is ready. */
export async function resolveLspProbeSkipReason(): Promise<string | null> {
  const cfg = await fetchLspConfig();
  if (!cfg) return 'LSP config unavailable';
  if (!cfg.enabled) return 'LSP disabled in settings';
  const servers = cfg.servers ?? [];
  if (!lspServersUsable(servers)) return 'no LSP server available';
  return null;
}
