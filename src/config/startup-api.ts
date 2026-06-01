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
  parseError?: string | null;
  status: DevServerLifecycleStatus;
  runId: string | null;
  pid: number | null;
  port: number | null;
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
export async function postDevServerStart(): Promise<{
  ok: boolean;
  status?: DevServerLifecycleStatus;
  runId?: string;
  error?: string;
  alreadyRunning?: boolean;
}> {
  const res = await fetch('/api/workspace/dev-server/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
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
