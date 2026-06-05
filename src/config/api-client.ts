/**
 * HTTP client for ~/.minnow config API (npm start only).
 */

import type { BugsState } from '../state/bug-board-store.ts';
import type { SessionState, SystemPromptSettings } from '../types';
import type { SkillConfig } from '../skills/config';
import type { ToolConfig } from '../tools/tool-settings-types';
import type { SearchConfig } from './search-config';
import type { ResearchConfig } from './research-config';
import type { UserRulesSettings } from './user-rules';
import {
  defaultSessionState,
  defaultSystemPromptSettings,
  defaultSkillConfig,
  defaultToolConfig,
  defaultUserRulesSettings,
} from './defaults';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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
  const res = await fetch('/api/config/sessions', { cache: 'no-store' });
  return parseJsonResponse<SessionState>(res);
}

/** GET /api/config/bugs */
export async function getBugs(): Promise<BugsState> {
  const res = await fetch('/api/config/bugs', { cache: 'no-store' });
  return parseJsonResponse<BugsState>(res);
}

/** PUT /api/config/bugs */
export async function putBugs(state: BugsState): Promise<void> {
  const res = await fetch('/api/config/bugs', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(state),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
}

/** PUT /api/config/sessions */
export async function putSessions(state: SessionState): Promise<void> {
  const res = await fetch('/api/config/sessions', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(state),
  });
  await parseJsonResponse<{ ok: boolean }>(res);
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
