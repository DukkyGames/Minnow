/**
 * Code map prompt injection: global default + per-chat tri-state resolution.
 */

import {
  mergeThinkingTriState,
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../agents/thinking-types';
import { fetchBrainCodeConfig } from './client';
import { getWorkspacePath } from '../state/workspace';
import { sessionState } from '../state/sessions';
import { resolveChatToolWorkspaceRoot } from '../state/worktree-isolation';
import type { Chat } from '../types';

/** Per-chat override; reuses thinking tri-state semantics (inherit / on / off). */
export type CodeMapInjectionTriState = ThinkingTriState;

/** Global default in config.json features.codeMapInjectionDefault (boolean, default false). */
export async function fetchCodeMapInjectionDefault(): Promise<boolean> {
  try {
    const res = await fetch('/api/config/file?key=config.json', {
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const config = (await res.json()) as {
      features?: { codeMapInjectionDefault?: boolean };
    };
    const features = config.features;
    if (features && typeof features.codeMapInjectionDefault === 'boolean') {
      return features.codeMapInjectionDefault;
    }
    return false;
  } catch {
    return false;
  }
}

/** Persist global code-map injection default (Settings / Brain Code). */
export async function saveCodeMapInjectionDefault(enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return false;
    const config = (await res.json()) as {
      features?: Record<string, boolean>;
    };
    const features =
      config.features && typeof config.features === 'object'
        ? { ...config.features }
        : {};
    features.codeMapInjectionDefault = enabled;
    config.features = features;
    const put = await fetch('/api/config/file?key=config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return put.ok;
  } catch {
    return false;
  }
}

export function resolveCodeMapInjectionTriState(chat: Chat): CodeMapInjectionTriState {
  return normalizeThinkingTriState(chat.codeMapInjection, 'inherit');
}

/** Resolved on/off after merging chat tri-state with the global boolean default. */
export function resolveCodeMapInjectionEnabled(
  chat: Chat,
  globalDefault: boolean,
): boolean {
  const base = globalDefault ? 'on' : 'off';
  const tri = resolveCodeMapInjectionTriState(chat);
  return mergeThinkingTriState(base, tri) === 'on';
}

/** Whether compose should fetch and inject the repo map for this send. */
export async function shouldInjectCodeMap(chat: Chat): Promise<boolean> {
  const globalDefault = await fetchCodeMapInjectionDefault();
  if (!resolveCodeMapInjectionEnabled(chat, globalDefault)) {
    return false;
  }
  const code = await fetchBrainCodeConfig();
  if (!code?.enabled) return false;
  const worktreeCwd = resolveChatToolWorkspaceRoot(chat, sessionState?.groups);
  const cwd = worktreeCwd?.trim() || getWorkspacePath().trim();
  if (!cwd) return false;
  return true;
}
