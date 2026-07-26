/**
 * HTTP client for ~/.minnow config API (npm start only).
 */

import type {
  BugsState,
  Chat,
  ChatGroup,
  IssuesState,
  Message,
  SessionState,
  SessionSummariesState,
  SystemPromptSettings,
} from '../types';
import type { IssuesTaxonomy } from '../issues/taxonomy';
import type { SkillConfig } from '../skills/config';
import type { ToolConfig } from '../tools/tool-settings-types';
import type { SearchConfig } from './search-config';
import type { ResearchConfig } from './research-config';
import type { UserRulesSettings } from './user-rules';
import { withSessionToken } from '../api/session-token';
import {
  defaultSessionState,
  defaultSystemPromptSettings,
  defaultSkillConfig,
  defaultToolConfig,
  defaultUserRulesSettings,
} from './defaults';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Fetch `keepalive` bodies are capped at 64 KiB by the Fetch spec (Chromium enforces).
 * Larger keepalive PUTs are often a silent no-op — prefer a small PATCH beacon below this.
 */
export const FETCH_KEEPALIVE_MAX_BYTES = 64 * 1024;

/** Prefer sendBeacon when the serialized sessions delta is under this size (margin under 64 KiB). */
export const SESSIONS_BEACON_MAX_BYTES = 60 * 1024;

/** Partial sessions write body for PATCH /api/config/sessions (and POST beacon alias). */
export interface SessionsPatchDelta {
  baseVersion: number;
  /** Phase 0 optimistic concurrency (also sent as If-Match). Not schema version. */
  expectedRev?: number;
  chats?: Chat[];
  deleteChatIds?: string[];
  groups?: ChatGroup[];
  deleteGroupIds?: string[];
  scalars?: Record<string, unknown>;
}

/** Shutdown transport chosen from serialized body size. */
export type SessionsShutdownTransport = 'beacon' | 'keepalive-put';

/** Pick beacon vs keepalive PUT from UTF-8 body length (unit-tested). */
export function chooseSessionsShutdownTransport(bodyByteLength: number): SessionsShutdownTransport {
  return bodyByteLength < SESSIONS_BEACON_MAX_BYTES ? 'beacon' : 'keepalive-put';
}

export interface ConfigStatusResponse {
  ok: boolean;
  storage: string;
  migrated: boolean;
  schemaVersion: number;
}

export interface MigrateBody {
  localStorage?: {
    sessions?: string;
    tools?: string;
    systemPrompt?: string;
  };
  clearLocalStorage?: boolean;
}

export interface MigrateResponse {
  ok: boolean;
  migrated?: boolean;
  skipped?: boolean;
  written?: string[];
  warnings?: string[];
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      errBody && typeof errBody === 'object' && 'error' in errBody
        ? String((errBody as { error: unknown }).error)
        : res.statusText;
    throw new Error(message || `Config API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** GET /api/config/status */
export async function fetchConfigStatus(): Promise<ConfigStatusResponse> {
  const res = await fetch('/api/config/status', { cache: 'no-store' });
  return parseJsonResponse<ConfigStatusResponse>(res);
}

/** GET /api/config/sessions */
export async function getSessions(): Promise<SessionState> {
  const result = await getSessionsWithRev();
  return result.state;
}

export interface SessionsWithRev {
  state: SessionState;
  rev: number;
}

/** Parse X-Session-Rev from a successful sessions response. */
function readSessionRevHeader(res: Response): number {
  const revHeader = res.headers.get('X-Session-Rev');
  const rev = revHeader ? Number.parseInt(revHeader, 10) : 0;
  return Number.isFinite(rev) ? rev : 0;
}

/** GET /api/config/sessions — includes monotonic revision (Phase 0). */
export async function getSessionsWithRev(): Promise<SessionsWithRev> {
  const res = await fetch('/api/config/sessions', { cache: 'no-store' });
  const state = await parseJsonResponse<SessionState>(res);
  return { state, rev: readSessionRevHeader(res) };
}

export class SessionRevisionConflictError extends Error {
  readonly rev: number;

  constructor(rev: number) {
    super('Session state revision conflict');
    this.name = 'SessionRevisionConflictError';
    this.rev = rev;
  }
}

/** Throw SessionRevisionConflictError when the server returns 409 on sessions write. */
async function throwIfSessionRevConflict(res: Response): Promise<void> {
  if (res.status !== 409) return;
  const errBody = await res.json().catch(() => ({}));
  const rev =
    errBody && typeof errBody === 'object' && 'rev' in errBody
      ? Number((errBody as { rev: unknown }).rev)
      : readSessionRevHeader(res);
  throw new SessionRevisionConflictError(Number.isFinite(rev) ? rev : 0);
}

/**
 * GET /api/config/bugs — read-only migration source for Issues (MIN-261).
 * Leftover bugs/state.json is left on disk after migration.
 */
/** GET /api/config/sessions/summaries?workspace=… — chats omit `history` (Phase C.1). */
export async function getSessionSummaries(workspace?: string): Promise<SessionSummariesState> {
  const result = await getSessionSummariesWithRev(workspace);
  return result.state;
}

/** GET summaries + Phase 0 revision header (boot path when lazy history is on). */
export async function getSessionSummariesWithRev(
  workspace?: string,
): Promise<{ state: SessionSummariesState; rev: number }> {
  const params = new URLSearchParams();
  if (workspace != null && workspace !== '') {
    params.set('workspace', workspace);
  }
  const qs = params.toString();
  const res = await fetch(`/api/config/sessions/summaries${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
  });
  const state = await parseJsonResponse<SessionSummariesState>(res);
  return { state, rev: readSessionRevHeader(res) };
}

/**
 * GET /api/config/sessions/history/:chatId — full message list for one chat.
 * Callers that compute absolute history indices must omit offset/limit.
 */
export async function getChatHistory(
  chatId: string,
  opts?: { offset?: number; limit?: number },
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/config/sessions/history/${encodeURIComponent(chatId)}${qs ? `?${qs}` : ''}`;
  const res = await fetch(path, { cache: 'no-store' });
  const body = await parseJsonResponse<{ chatId: string; history: Message[] }>(res);
  return Array.isArray(body.history) ? body.history : [];
}

/** One hit from GET /api/config/sessions/search (FTS5 / JSON fallback). */
export interface SessionSearchHit {
  chatId: string;
  name: string;
  workspacePath: string;
  lastMessageAt?: number;
  score: number;
  matchedIn: 'title' | 'message';
  role?: 'user' | 'assistant';
  snippet: string;
}

/**
 * GET /api/config/sessions/search?q= — server FTS over titles + message bodies (C.2).
 */
export async function searchSessions(
  query: string,
  opts?: { workspace?: string; limit?: number },
): Promise<SessionSearchHit[]> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (opts?.workspace != null && opts.workspace !== '') {
    params.set('workspace', opts.workspace);
  }
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const res = await fetch(`/api/config/sessions/search?${params}`, { cache: 'no-store' });
  const body = await parseJsonResponse<{ results: SessionSearchHit[] }>(res);
  return Array.isArray(body.results) ? body.results : [];
}

/** GET /api/config/bugs */
export async function getBugs(): Promise<BugsState> {
  const res = await fetch('/api/config/bugs', { cache: 'no-store' });
  return parseJsonResponse<BugsState>(res);
}

/**
 * GET /api/config/issues
 * Returns null when the issues file has never been written (triggers migration).
 */
export async function getIssues(): Promise<IssuesState | null> {
  const res = await fetch('/api/config/issues', { cache: 'no-store' });
  if (res.status === 404) return null;
  return parseJsonResponse<IssuesState>(res);
}

/** PUT /api/config/issues */
export async function putIssues(state: IssuesState): Promise<void> {
  const res = await fetch('/api/config/issues', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(state),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/**
 * GET /api/config/issues-taxonomy
 * Returns null when the taxonomy file has never been written (client seeds defaults).
 */
export async function getIssuesTaxonomy(): Promise<IssuesTaxonomy | null> {
  const res = await fetch('/api/config/issues-taxonomy', { cache: 'no-store' });
  if (res.status === 404) return null;
  return parseJsonResponse<IssuesTaxonomy>(res);
}

/** PUT /api/config/issues-taxonomy */
export async function putIssuesTaxonomy(taxonomy: IssuesTaxonomy): Promise<void> {
  const res = await fetch('/api/config/issues-taxonomy', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(taxonomy),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/** PUT /api/config/sessions — optional If-Match rev; returns new rev. */
export async function putSessions(state: SessionState, expectedRev?: number): Promise<number> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (expectedRev != null && Number.isFinite(expectedRev) && expectedRev > 0) {
    headers['If-Match'] = String(expectedRev);
  }
  const res = await fetch('/api/config/sessions', {
    method: 'PUT',
    headers,
    body: JSON.stringify(state),
  });
  await throwIfSessionRevConflict(res);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      errBody && typeof errBody === 'object' && 'error' in errBody
        ? String((errBody as { error: unknown }).error)
        : res.statusText;
    throw new Error(message || `Config API ${res.status}`);
  }
  const body = (await res.json()) as { rev?: number };
  const rev = body.rev ?? readSessionRevHeader(res);
  return Number.isFinite(rev) ? rev : 0;
}

/** PATCH /api/config/sessions — partial upsert / explicit deletes; returns new rev. */
export async function patchSessions(delta: SessionsPatchDelta): Promise<number> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  const expectedRev = delta.expectedRev;
  if (expectedRev != null && Number.isFinite(expectedRev) && expectedRev > 0) {
    headers['If-Match'] = String(expectedRev);
  }
  const res = await fetch('/api/config/sessions', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(delta),
  });
  await throwIfSessionRevConflict(res);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      errBody && typeof errBody === 'object' && 'error' in errBody
        ? String((errBody as { error: unknown }).error)
        : res.statusText;
    throw new Error(message || `Config API ${res.status}`);
  }
  const body = (await res.json()) as { rev?: number };
  const rev = body.rev ?? readSessionRevHeader(res);
  return Number.isFinite(rev) ? rev : 0;
}

/**
 * Best-effort whole-blob session save during `pagehide` / abrupt shutdown.
 * `keepalive` lets the browser finish the request after the tab closes.
 *
 * Note: browsers cap keepalive bodies at {@link FETCH_KEEPALIVE_MAX_BYTES} (64 KiB).
 * A full SessionState often exceeds that, so this path was likely a silent no-op for
 * large blobs — prefer {@link sendSessionsPatchBeacon} when the delta fits.
 */
export function putSessionsKeepalive(state: SessionState, expectedRev?: number): void {
  try {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    // Phase 0: keepalive PUT still participates in optimistic concurrency when rev is known.
    if (expectedRev != null && Number.isFinite(expectedRev) && expectedRev > 0) {
      headers['If-Match'] = String(expectedRev);
    }
    void fetch('/api/config/sessions', {
      method: 'PUT',
      headers,
      body: JSON.stringify(state),
      keepalive: true,
    }).catch(() => {
      /* ignore — server may already be down during pagehide */
    });
  } catch {
    /* ignore — nothing else we can do during unload */
  }
}

/**
 * Queue a PATCH-shaped sessions delta via `navigator.sendBeacon` (POST alias).
 * sendBeacon cannot PATCH; the server accepts POST /api/config/sessions as PATCH.
 * @returns true when the browser accepted the beacon (best-effort success).
 */
export function sendSessionsPatchBeacon(delta: SessionsPatchDelta): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
      return false;
    }
    const body = JSON.stringify(delta);
    const blob = new Blob([body], { type: 'application/json' });
    // sendBeacon cannot use the fetch interceptor — append ?token= for auth-middleware.
    return navigator.sendBeacon(withSessionToken('/api/config/sessions'), blob);
  } catch {
    return false;
  }
}

/**
 * Shutdown flush: beacon POST when the delta is small; otherwise keepalive whole-blob PUT.
 * @returns whether the dirty sets may be cleared (beacon queued, or keepalive PUT dispatched).
 */
export function flushSessionsOnShutdown(
  delta: SessionsPatchDelta | null,
  fullState: SessionState,
): { transport: SessionsShutdownTransport; clearedOk: boolean } {
  if (delta) {
    const body = JSON.stringify(delta);
    // Prefer byteLength for UTF-8; fall back to string length in odd environments.
    const byteLength =
      typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(body).length : body.length;
    const transport = chooseSessionsShutdownTransport(byteLength);
    if (transport === 'beacon') {
      const queued = sendSessionsPatchBeacon(delta);
      if (queued) return { transport, clearedOk: true };
      // Beacon rejected — fall through to keepalive PUT of the whole blob.
    }
  }
  const expectedRev =
    delta && typeof delta.expectedRev === 'number' && delta.expectedRev > 0
      ? delta.expectedRev
      : undefined;
  putSessionsKeepalive(fullState, expectedRev);
  return { transport: 'keepalive-put', clearedOk: true };
}

/** GET /api/config/tools */
export async function getTools(): Promise<ToolConfig> {
  const res = await fetch('/api/config/tools', { cache: 'no-store' });
  return parseJsonResponse<ToolConfig>(res);
}

/** PUT /api/config/tools */
export async function putTools(config: ToolConfig): Promise<void> {
  const res = await fetch('/api/config/tools', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(config),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/** GET /api/config/search */
export async function getSearch(): Promise<SearchConfig> {
  const res = await fetch('/api/config/search', { cache: 'no-store' });
  return parseJsonResponse<SearchConfig>(res);
}

/** PUT /api/config/search */
export async function putSearch(config: SearchConfig): Promise<SearchConfig> {
  const res = await fetch('/api/config/search', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(config),
  });
  const body = await parseJsonResponse<{ ok: boolean; data: SearchConfig }>(res);
  return body.data;
}

/** GET /api/config/research */
export async function getResearch(): Promise<ResearchConfig> {
  const res = await fetch('/api/config/research', { cache: 'no-store' });
  return parseJsonResponse<ResearchConfig>(res);
}

/** PUT /api/config/research */
export async function putResearch(config: ResearchConfig): Promise<ResearchConfig> {
  const res = await fetch('/api/config/research', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(config),
  });
  const body = await parseJsonResponse<{ ok: boolean; data: ResearchConfig }>(res);
  return body.data;
}

/** GET /api/config/skills */
export async function getSkills(): Promise<SkillConfig> {
  const res = await fetch('/api/config/skills', { cache: 'no-store' });
  return parseJsonResponse<SkillConfig>(res);
}

/** PUT /api/config/skills */
export async function putSkills(config: SkillConfig): Promise<void> {
  const res = await fetch('/api/config/skills', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(config),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/** GET /api/config/system-prompt */
export async function getSystemPrompt(): Promise<SystemPromptSettings> {
  const res = await fetch('/api/config/system-prompt', { cache: 'no-store' });
  return parseJsonResponse<SystemPromptSettings>(res);
}

/** PUT /api/config/system-prompt */
export async function putSystemPrompt(settings: SystemPromptSettings): Promise<void> {
  const res = await fetch('/api/config/system-prompt', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/** GET /api/config/rules */
export async function getRules(): Promise<UserRulesSettings> {
  const res = await fetch('/api/config/rules', { cache: 'no-store' });
  return parseJsonResponse<UserRulesSettings>(res);
}

/** PUT /api/config/rules */
export async function putRules(settings: UserRulesSettings): Promise<void> {
  const res = await fetch('/api/config/rules', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/** POST /api/config/migrate */
export async function postMigrate(body: MigrateBody): Promise<MigrateResponse> {
  const res = await fetch('/api/config/migrate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return parseJsonResponse<MigrateResponse>(res);
}

export {
  defaultSessionState,
  defaultSkillConfig,
  defaultToolConfig,
  defaultSystemPromptSettings,
  defaultUserRulesSettings,
};
