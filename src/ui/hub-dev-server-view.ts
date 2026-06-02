/**
 * Pure hub dev-server cell view model (testable without DOM / terminal).
 */

import type {
  DevServerLifecycleStatus,
  DevServerNetwork,
} from '../config/startup-api';

export type HubDevServerUiState =
  | 'offline'
  | 'setup'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export interface HubDevServerViewModel {
  uiState: HubDevServerUiState;
  label: string;
  meta: string;
  primaryDisabled: boolean;
  showConsole: boolean;
  settingsDisabled: boolean;
  port: number;
  network: DevServerNetwork;
}

function formatNetworkLabel(network: DevServerNetwork): string {
  return network === 'lan' ? 'network' : 'this PC';
}

function formatPortMeta(port: number | null | undefined, network: DevServerNetwork): string {
  if (port == null) return formatNetworkLabel(network);
  return `:${port} · ${formatNetworkLabel(network)}`;
}

/** Status line under the dev-server label (port + bind mode). */
export function formatHubDevServerMeta(
  status: DevServerLifecycleStatus,
  error: string | null | undefined,
  port: number | null | undefined,
  network: DevServerNetwork,
): string {
  if (status === 'starting') return `starting… ${formatPortMeta(port, network)}`;
  if (status === 'running') return `running ${formatPortMeta(port, network)}`;
  if (status === 'stopping') return 'stopping…';
  if (status === 'error') {
    const short =
      error && error.length > 36 ? `${error.slice(0, 33)}…` : (error ?? 'start failed');
    return short;
  }
  if (status === 'stopped') return `stopped ${formatPortMeta(port, network)}`;
  return 'stopped';
}

/** Map API status + server availability to hub cell presentation. */
export function deriveHubDevServerView(
  serverOnline: boolean,
  status: DevServerLifecycleStatus,
  error?: string | null,
  _runId?: string | null,
  port: number = 5173,
  network: DevServerNetwork = 'local',
): HubDevServerViewModel {
  const settingsDisabled =
    !serverOnline ||
    status === 'starting' ||
    status === 'running' ||
    status === 'stopping';

  if (!serverOnline) {
    return {
      uiState: 'offline',
      label: 'Dev server',
      meta: 'server offline',
      primaryDisabled: true,
      showConsole: false,
      settingsDisabled: true,
      port,
      network,
    };
  }

  if (status === 'no_guide') {
    return {
      uiState: 'setup',
      label: 'Set up',
      meta: 'no startup guide',
      primaryDisabled: false,
      showConsole: false,
      settingsDisabled: false,
      port,
      network,
    };
  }

  if (status === 'starting') {
    return {
      uiState: 'starting',
      label: 'Dev server',
      meta: formatHubDevServerMeta(status, error, port, network),
      primaryDisabled: true,
      showConsole: true,
      settingsDisabled: true,
      port,
      network,
    };
  }

  if (status === 'running') {
    return {
      uiState: 'running',
      label: 'Dev server',
      meta: formatHubDevServerMeta(status, error, port, network),
      primaryDisabled: false,
      showConsole: true,
      settingsDisabled: true,
      port,
      network,
    };
  }

  if (status === 'stopping') {
    return {
      uiState: 'stopping',
      label: 'Dev server',
      meta: formatHubDevServerMeta(status, error, port, network),
      primaryDisabled: true,
      showConsole: true,
      settingsDisabled: true,
      port,
      network,
    };
  }

  if (status === 'error') {
    return {
      uiState: 'error',
      label: 'Dev server',
      meta: formatHubDevServerMeta(status, error, port, network),
      primaryDisabled: false,
      showConsole: true,
      settingsDisabled: false,
      port,
      network,
    };
  }

  return {
    uiState: 'stopped',
    label: 'Dev server',
    meta: formatHubDevServerMeta('stopped', error, port, network),
    primaryDisabled: false,
    showConsole: false,
    settingsDisabled: false,
    port,
    network,
  };
}
