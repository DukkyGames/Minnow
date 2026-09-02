/**
 * One-time migration from browser localStorage to ~/.minnow.
 */

import { PRESET_STORAGE_KEY, STORAGE_KEY } from '../constants';
import { TOOL_CONFIG_STORAGE_KEY } from '../tools/config';
import { postMigrate, fetchConfigStatus } from './api-client';
import { isServerStorageMode } from './storage-mode';

/** Read legacy localStorage keys for migration POST. */
function readLegacyLocalStorage(): {
  sessions?: string;
  tools?: string;
  systemPrompt?: string;
} {
  const out: {
    sessions?: string;
    tools?: string;
    systemPrompt?: string;
  } = {};

  const legacySessionsKey = 'speedchat-sessions-v1';
  const legacyToolsKey = 'speedchat.tools';
  const legacySystemPromptKey = 'speedchat.systemPrompt';

  try {
    const sessions =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(legacySessionsKey);
    if (sessions) out.sessions = sessions;
  } catch {}

  try {
    const tools =
      localStorage.getItem(TOOL_CONFIG_STORAGE_KEY) ?? localStorage.getItem(legacyToolsKey);
    if (tools) out.tools = tools;
  } catch {}

  try {
    const systemPrompt =
      localStorage.getItem(PRESET_STORAGE_KEY) ??
      localStorage.getItem(legacySystemPromptKey);
    if (systemPrompt) out.systemPrompt = systemPrompt;
  } catch {}

  return out;
}

/** Remove legacy keys after successful migration. */
function clearLegacyLocalStorage(): void {
  const keys = [
    STORAGE_KEY,
    TOOL_CONFIG_STORAGE_KEY,
    PRESET_STORAGE_KEY,
    'speedchat-sessions-v1',
    'speedchat.tools',
    'speedchat.systemPrompt',
    'speedchat.skills',
    'speedchat.subAgents',
    'speedchat.experts',
    'speedchat.titlesMeta',
  ];
  try {
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}

/**
 * POST /api/config/migrate when server storage is up and not yet migrated.
 * @returns true when a migration ran and sessions should be re-fetched.
 */
export async function runMigrationIfNeeded(): Promise<boolean> {
  if (!isServerStorageMode()) return false;

  try {
    const status = await fetchConfigStatus();
    if (status.migrated) return false;

    const localStoragePayload = readLegacyLocalStorage();
    const hasData =
      localStoragePayload.sessions ||
      localStoragePayload.tools ||
      localStoragePayload.systemPrompt;

    if (!hasData) return false;

    const result = await postMigrate({
      localStorage: localStoragePayload,
      clearLocalStorage: true,
    });

    if (result.ok && !result.skipped) {
      clearLegacyLocalStorage();
      return true;
    }
  } catch (err) {
    console.warn('[Minnow] Config migration failed:', err);
  }
  return false;
}
