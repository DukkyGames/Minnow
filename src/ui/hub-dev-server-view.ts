/**
 * Pure hub dev-server cell view model (testable without DOM / terminal).
 */

import {
  DEFAULT_DEV_SERVER_PORT,
  type DevServerLifecycleStatus,
  type DevServerNetwork,
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
  /** Full URL to open in the system browser when the server is up. */
  openUrl: string | null;
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

/**
 * User-facing URL for the hub link (localhost on this machine; port from hub settings).
 */
export function formatHubDevServerOpenUrl(
  healthUrl: string | null | undefined,
  port: number,
  _network: DevServerNetwork = 'local',
): string {
  if (healthUrl) {
    try {
      const u = new URL(healthUrl);
      u.hostname = 'localhost';
      u.port = String(port);
      return u.toString();
    } catch {
      /* fall through */
    }
  }
  return `http://localhost:${port}/`;
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
function openUrlForStatus(
  status: DevServerLifecycleStatus,
  healthUrl: string | null | undefined,
  port: number,
  network: DevServerNetwork,
): string | null {
  if (status !== 'starting' && status !== 'running') return null;
  return formatHubDevServerOpenUrl(healthUrl, port, network);
}

export function deriveHubDevServerView(
  serverOnline: boolean,
  status: DevServerLifecycleStatus,
  error?: string | null,
  _runId?: string | null,
  port: number = DEFAULT_DEV_SERVER_PORT,
  network: DevServerNetwork = 'local',
  healthUrl?: string | null,
): HubDevServerViewModel {
  const settingsDisabled =
    !serverOnline ||
    status === 'starting' ||
    status === 'running' ||
    status === 'stopping';
  const openUrl = openUrlForStatus(status, healthUrl, port, network);

  if (!serverOnline) {
    return {
      uiState: 'offline',
      label: 'Dev server',
      meta: 'server offline',
      openUrl: null,
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
      openUrl: null,
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
      openUrl,
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
      openUrl,
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
      openUrl: null,
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
      openUrl: null,
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
    openUrl: null,
    primaryDisabled: false,
    showConsole: false,
    settingsDisabled: false,
    port,
    network,
  };
}
