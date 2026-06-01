/**
 * Pure hub dev-server cell view model (testable without DOM / terminal).
 */

import type { DevServerLifecycleStatus } from '../config/startup-api';

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
}

/** Map API status + server availability to hub cell presentation. */
export function deriveHubDevServerView(
  serverOnline: boolean,
  status: DevServerLifecycleStatus,
  error?: string | null,
  _runId?: string | null,
): HubDevServerViewModel {
  if (!serverOnline) {
    return {
      uiState: 'offline',
      label: 'Dev server',
      meta: 'server offline',
      primaryDisabled: true,
      showConsole: false,
    };
  }

  if (status === 'no_guide') {
    return {
      uiState: 'setup',
      label: 'Set up',
      meta: 'no startup guide',
      primaryDisabled: false,
      showConsole: false,
    };
  }

  if (status === 'starting') {
    return {
      uiState: 'starting',
      label: 'Dev server',
      meta: 'starting…',
      primaryDisabled: true,
      showConsole: true,
    };
  }

  if (status === 'running') {
    return {
      uiState: 'running',
      label: 'Dev server',
      meta: 'running',
      primaryDisabled: false,
      showConsole: true,
    };
  }

  if (status === 'stopping') {
    return {
      uiState: 'stopping',
      label: 'Dev server',
      meta: 'stopping…',
      primaryDisabled: true,
      showConsole: true,
    };
  }

  if (status === 'error') {
    const short =
      error && error.length > 48 ? `${error.slice(0, 45)}…` : (error ?? 'start failed');
    return {
      uiState: 'error',
      label: 'Dev server',
      meta: short,
      primaryDisabled: false,
      showConsole: true,
    };
  }

  return {
    uiState: 'stopped',
    label: 'Dev server',
    meta: 'stopped',
    primaryDisabled: false,
    showConsole: false,
  };
}
