/**
 * Workspace dev-server API (requires npm start / local tool server).
 */

export type DevServerLifecycleStatus =
  | 'no_guide'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export type DevServerNetwork = 'local' | 'lan';

/** Default workspace dev-server port (distinct from Minnow's host port in server/constants/minnow-port.js). */
export const DEFAULT_DEV_SERVER_PORT = 3000;

export interface DevServerSettings {
  port: number;
  network: DevServerNetwork;
}

export interface StartupGuide {
  command: string;
  cwd?: string;
  healthUrl?: string;
  port?: number;
  stop?: { command?: string };
}

export interface WorkspaceStartupResponse {
  ok?: boolean;
  exists: boolean;
  parsed: boolean;
  guide: StartupGuide | null;
  parseError?: string | null;
  status: DevServerLifecycleStatus;
  runId?: string | null;
  error?: string | null;
}

export interface DevServerStatusResponse {
  ok?: boolean;
  workspacePath: string;
  startupExists: boolean;
  guide: StartupGuide | null;
  settings?: DevServerSettings;
  parseError?: string | null;
  status: DevServerLifecycleStatus;
  runId: string | null;
  pid: number | null;
  port: number | null;
  network?: DevServerNetwork | null;
  healthUrl: string | null;
  healthOk: boolean | null;
  error: string | null;
  command: string | null;
  startedAt: number | null;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Fetch startup.md presence and coarse dev-server status. */
export async function fetchWorkspaceStartup(): Promise<WorkspaceStartupResponse> {
  const res = await fetch('/api/workspace/startup', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`startup probe failed (${res.status})`);
  }
  return readJson<WorkspaceStartupResponse>(res);
}

/** Poll-friendly dev-server status for the active workspace. */
export async function fetchDevServerStatus(): Promise<DevServerStatusResponse> {
  const res = await fetch('/api/workspace/dev-server/status', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`dev-server status failed (${res.status})`);
  }
  return readJson<DevServerStatusResponse>(res);
}

/** Start the dev server from startup.md (idempotent when already running). */
export async function postDevServerStart(
  settings?: Partial<DevServerSettings>,
): Promise<{
  ok: boolean;
  status?: DevServerLifecycleStatus;
  runId?: string;
  error?: string;
  alreadyRunning?: boolean;
}> {
  const res = await fetch('/api/workspace/dev-server/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings ?? {}),
  });
  return readJson(res);
}

/** Stop the managed dev server for the active workspace. */
export async function postDevServerStop(): Promise<{
  ok: boolean;
  status?: DevServerLifecycleStatus;
}> {
  const res = await fetch('/api/workspace/dev-server/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return readJson(res);
}

/** Read hub dev-server port / network settings for the active workspace. */
export async function fetchDevServerSettings(): Promise<DevServerSettings> {
  const res = await fetch('/api/workspace/dev-server/settings', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`dev-server settings failed (${res.status})`);
  }
  const json = (await res.json()) as { ok?: boolean; settings: DevServerSettings };
  return json.settings;
}

/** Persist hub dev-server port / network settings for the active workspace. */
export async function putDevServerSettings(
  patch: Partial<DevServerSettings>,
): Promise<DevServerSettings> {
  const res = await fetch('/api/workspace/dev-server/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`dev-server settings save failed (${res.status})`);
  }
  const json = (await res.json()) as { ok?: boolean; settings: DevServerSettings };
  return json.settings;
}
