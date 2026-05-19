/**
 * One-time migration from browser localStorage to ~/.speedchat.
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

  try {
    const sessions = localStorage.getItem(STORAGE_KEY);
    if (sessions) out.sessions = sessions;
  } catch {
    /* ignore */
  }

  try {
    const tools = localStorage.getItem(TOOL_CONFIG_STORAGE_KEY);
    if (tools) out.tools = tools;
  } catch {
    /* ignore */
  }

  try {
    const systemPrompt = localStorage.getItem(PRESET_STORAGE_KEY);
    if (systemPrompt) out.systemPrompt = systemPrompt;
  } catch {
    /* ignore */
  }

  return out;
}

/** Remove legacy keys after successful migration. */
function clearLegacyLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOOL_CONFIG_STORAGE_KEY);
    localStorage.removeItem(PRESET_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * POST /api/config/migrate when server storage is up and not yet migrated.
 */
export async function runMigrationIfNeeded(): Promise<void> {
  if (!isServerStorageMode()) return;

  try {
    const status = await fetchConfigStatus();
    if (status.migrated) return;

    const localStoragePayload = readLegacyLocalStorage();
    const hasData =
      localStoragePayload.sessions ||
      localStoragePayload.tools ||
      localStoragePayload.systemPrompt;

    if (!hasData) return;

    const result = await postMigrate({
      localStorage: localStoragePayload,
      clearLocalStorage: true,
    });

    if (result.ok && !result.skipped) {
      clearLegacyLocalStorage();
    }
  } catch (err) {
    console.warn('[SpeedChat] Config migration failed:', err);
  }
}
