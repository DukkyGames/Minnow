/**
 * Interactive PTY session API (requires npm start).
 */

import { withSessionToken } from './session-token.ts';

export interface ShellProfile {
  id: string;
  label: string;
  shell: string;
  args: string[];
  platform: string;
  runtime?: 'native' | 'wsl';
  distro?: string;
}

export interface PtySessionCreated {
  sessionId: string;
  shell: string;
  shellProfileId: string;
  cwd: string;
  pid?: number;
  cols: number;
  rows: number;
}

export type PtyServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'meta'; sessionId: string; shell: string; shellProfileId?: string };

/** Fetch OS-gated shell profiles. */
export async function fetchShellProfiles(): Promise<{
  profiles: ShellProfile[];
  ptyAvailable: boolean;
  defaultShellProfileId?: string;
}> {
  const res = await fetch('/api/terminal/shell-profiles', { cache: 'no-store' });
  if (!res.ok) throw new Error(`shell-profiles ${res.status}`);
  const body = (await res.json()) as {
    profiles: ShellProfile[];
    ptyAvailable?: boolean;
    defaultShellProfileId?: string;
  };
  return {
    profiles: body.profiles ?? [],
    ptyAvailable: body.ptyAvailable !== false,
    defaultShellProfileId: body.defaultShellProfileId,
  };
}

/** Create a new PTY session on the server. */
export async function createTerminalSession(options: {
  shellProfileId?: string;
  cols?: number;
  rows?: number;
  chatId?: string | null;
  /** Absolute cwd for the PTY; server falls back to chat worktree or workspace. */
  cwd?: string;
}): Promise<PtySessionCreated> {
  const res = await fetch('/api/terminal/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const body = (await res.json()) as PtySessionCreated & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `session ${res.status}`);
  }
  return body;
}

/** Destroy a PTY session. */
export async function deleteTerminalSession(sessionId: string): Promise<void> {
  await fetch(`/api/terminal/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

/** Notify server of terminal dimensions. */
export async function resizeTerminalSession(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await fetch(
    `/api/terminal/session/${encodeURIComponent(sessionId)}/resize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    },
  );
}

/** Build WebSocket URL for a session (same origin). */
export function buildTerminalWsUrl(sessionId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return withSessionToken(
    `${proto}//${host}/api/terminal/ws?sessionId=${encodeURIComponent(sessionId)}`,
  );
}

/** Parse a server PTY WebSocket message. */
export function parsePtyServerMessage(raw: string): PtyServerMessage | null {
  try {
    const msg = JSON.parse(raw) as PtyServerMessage;
    if (msg?.type === 'output' && typeof msg.data === 'string') return msg;
    if (msg?.type === 'exit' && typeof msg.code === 'number') return msg;
    if (msg?.type === 'meta' && typeof msg.sessionId === 'string') return msg;
    return null;
  } catch {
    return null;
  }
}
