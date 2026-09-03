/**
 * Code map prompt injection: global default + per-chat tri-state resolution.
 */

import {
  mergeThinkingTriState,
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../agents/thinking-types';
import {
  getCachedDesktopWorkspacePath,
  getDesktopWorkspacePath,
  isDesktopWorkspacePath,
} from '../lib/desktop-workspace';
import {
  readConfigFile,
  readConfigFlag,
  writeConfigFile,
} from '../config/config-file-cache';
import { fetchBrainCodeConfig } from './client';
import { getWorkspacePath } from '../state/workspace';
import { sessionState } from '../state/sessions';
import { resolveChatToolWorkspaceRoot } from '../state/chat-worktree';
import type { Chat } from '../types';

/** Per-chat override; reuses thinking tri-state semantics (inherit / on / off). */
export type CodeMapInjectionTriState = ThinkingTriState;

/** Global default in config.json features.codeMapInjectionDefault (boolean, default false). */
export async function fetchCodeMapInjectionDefault(): Promise<boolean> {
  return readConfigFlag(['features', 'codeMapInjectionDefault'], false);
}

/** Persist global code-map injection default (Settings / Brain Code). */
export async function saveCodeMapInjectionDefault(enabled: boolean): Promise<boolean> {
  const config = await readConfigFile({ fresh: true });
  if (!config) return false;
  const prev = config.features;
  const features =
    prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
  features.codeMapInjectionDefault = enabled;
  config.features = features;
  return writeConfigFile(config);
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

/** True when the chat's tool workspace is the Minnow desktop sandbox (not Code app project). */
export async function chatUsesDesktopSandboxWorkspace(chat: Chat): Promise<boolean> {
  const desktopPath =
    getCachedDesktopWorkspacePath() ?? (await getDesktopWorkspacePath());
  if (!desktopPath) return false;
  const worktreeCwd = resolveChatToolWorkspaceRoot(chat, sessionState?.groups);
  const cwd = worktreeCwd?.trim() || getWorkspacePath().trim();
  if (!cwd) return false;
  return isDesktopWorkspacePath(cwd, desktopPath);
}

/** Whether compose should fetch and inject the repo map for this send. */
export async function shouldInjectCodeMap(chat: Chat): Promise<boolean> {
  if (await chatUsesDesktopSandboxWorkspace(chat)) {
    return false;
  }
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
