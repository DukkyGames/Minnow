/**
 * Global user rules persisted in ~/.minnow/rules.json (Settings → Rules).
 */

import { detectConfigServer } from './storage-mode';
import { getRules, putRules } from './api-client';
import { defaultUserRulesSettings } from './defaults';

export interface UserRulesSettings {
  version: 1;
  enabled: boolean;
  text: string;
}

const USER_RULES_STORAGE_KEY = 'minnow.userRules';

/** Max UTF-8 bytes for rules text (matches server validator). */
export const MAX_USER_RULES_BYTES = 16 * 1024;

let cachedRules: UserRulesSettings | null = null;

function normalizeUserRules(raw: Partial<UserRulesSettings> | null | undefined): UserRulesSettings {
  const base = defaultUserRulesSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: 1,
    enabled: raw.enabled === true,
    text: typeof raw.text === 'string' ? raw.text : '',
  };
}

function readLocalUserRules(): UserRulesSettings {
  try {
    const stored = localStorage.getItem(USER_RULES_STORAGE_KEY);
    if (!stored) return defaultUserRulesSettings();
    return normalizeUserRules(JSON.parse(stored) as Partial<UserRulesSettings>);
  } catch {
    return defaultUserRulesSettings();
  }
}

function writeLocalUserRules(settings: UserRulesSettings): void {
  localStorage.setItem(USER_RULES_STORAGE_KEY, JSON.stringify(settings));
}

/** Load user rules (cached until reset). Server-first when npm start is up. */
export async function loadUserRules(): Promise<UserRulesSettings> {
  if (cachedRules) return cachedRules;

  const serverUp = await detectConfigServer();
  if (serverUp) {
    try {
      cachedRules = normalizeUserRules(await getRules());
      writeLocalUserRules(cachedRules);
      return cachedRules;
    } catch {
      cachedRules = readLocalUserRules();
      return cachedRules;
    }
  }

  cachedRules = readLocalUserRules();
  return cachedRules;
}

/** Synchronous read of last loaded or local fallback. */
export function getUserRulesSync(): UserRulesSettings {
  return cachedRules ?? readLocalUserRules();
}

/** Persist user rules to server and localStorage mirror. */
export async function saveUserRules(settings: UserRulesSettings): Promise<void> {
  const normalized = normalizeUserRules(settings);
  const bytes = new TextEncoder().encode(normalized.text).length;
  if (bytes > MAX_USER_RULES_BYTES) {
    throw new Error(`User rules text exceeds ${MAX_USER_RULES_BYTES} bytes`);
  }

  writeLocalUserRules(normalized);
  cachedRules = normalized;

  const serverUp = await detectConfigServer();
  if (!serverUp) return;

  await putRules(normalized);
}

/** Clear in-memory cache (tests or after external edits). */
export function resetUserRulesCache(): void {
  cachedRules = null;
}

/**
 * Trimmed rules body for the second system message on send.
 * Returns null when disabled or empty.
 */
export function getUserRulesPayloadForSend(settings: UserRulesSettings): string | null {
  if (!settings.enabled) return null;
  const trimmed = settings.text.trim();
  return trimmed || null;
}
