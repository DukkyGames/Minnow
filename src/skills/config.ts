/**
 * Per-skill enablement — ~/.minnow/skills.json when npm start,
 * else localStorage (`minnow.skills`).
 */

import { getSkills, putSkills } from '../config/api-client';
import { isServerStorageMode } from '../config/storage-mode';
import { setStatus } from '../ui/status';

export const SKILL_CONFIG_STORAGE_KEY = 'minnow.skills';

/** Persisted skill toggles; missing ids default to enabled. */
export interface SkillConfig {
  enabled: Record<string, boolean>;
}

let cachedConfig: SkillConfig | null = null;
let skillConfigLoaded = false;

/** Default: all skills enabled unless explicitly disabled. */
export function defaultSkillConfig(): SkillConfig {
  return { enabled: {} };
}

/** Merge stored JSON with defaults. */
export function normalizeSkillConfig(raw: unknown): SkillConfig {
  const config = defaultSkillConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = raw as { enabled?: unknown };
  if (!stored.enabled || typeof stored.enabled !== 'object') return config;

  const enabledMap = stored.enabled as Record<string, unknown>;
  for (const [id, value] of Object.entries(enabledMap)) {
    if (typeof value === 'boolean' && /^[a-z0-9][a-z0-9-]*$/.test(id)) {
      config.enabled[id] = value;
    }
  }

  return config;
}

/** Load skill config from API or localStorage. */
export async function loadSkillConfigFromStorage(): Promise<SkillConfig> {
  if (isServerStorageMode()) {
    try {
      cachedConfig = normalizeSkillConfig(await getSkills());
      skillConfigLoaded = true;
      return cachedConfig;
    } catch {
      setStatus('err', 'Could not load skill settings from ~/.minnow');
    }
  }

  try {
    const raw = localStorage.getItem(SKILL_CONFIG_STORAGE_KEY);
    cachedConfig = raw
      ? normalizeSkillConfig(JSON.parse(raw) as unknown)
      : defaultSkillConfig();
  } catch {
    cachedConfig = defaultSkillConfig();
  }

  skillConfigLoaded = true;
  return cachedConfig;
}

/** Read config from memory (defaults if not loaded). */
export function getSkillConfig(): SkillConfig {
  if (cachedConfig) return cachedConfig;
  if (!skillConfigLoaded) {
    void loadSkillConfigFromStorage();
  }
  return defaultSkillConfig();
}

/** Persist skill config. */
export function saveSkillConfig(config: SkillConfig): void {
  cachedConfig = config;

  if (isServerStorageMode()) {
    void putSkills(config).catch(() => {
      setStatus('err', 'Could not save skill settings to ~/.minnow');
    });
    return;
  }

  try {
    localStorage.setItem(SKILL_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore quota / private mode */
  }
}

/** True when a skill is enabled (default enabled). */
export function isSkillEnabled(id: string): boolean {
  const value = getSkillConfig().enabled[id];
  return value !== false;
}

/** Set enabled flag and persist. */
export function setSkillEnabled(id: string, enabled: boolean): void {
  const config = getSkillConfig();
  config.enabled[id] = enabled;
  saveSkillConfig(config);
}
