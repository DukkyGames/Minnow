/**
 * Per-skill enablement — ~/.minnow/skills.json when npm start,
 * else localStorage (`minnow.skills`).
 */

import { getSkills, putSkills } from '../config/api-client';
import { isServerStorageMode } from '../config/storage-mode';
import { setStatus } from '../ui/status';
import {
  CAVEMAN_INTENSITIES,
  DEFAULT_CAVEMAN_INTENSITY,
  type CavemanIntensity,
  isCavemanIntensity,
} from './caveman-client';
import type { PinnedSkillState } from './types';

export const SKILL_CONFIG_STORAGE_KEY = 'minnow.skills';

/** User defaults for the built-in caveman skill. */
export interface CavemanSkillSettings {
  pinByDefault: boolean;
  defaultIntensity: CavemanIntensity;
}

/** Persisted skill toggles; missing ids default to enabled. */
export interface SkillConfig {
  enabled: Record<string, boolean>;
  caveman?: CavemanSkillSettings;
}

let cachedConfig: SkillConfig | null = null;
let skillConfigLoaded = false;

export const DEFAULT_CAVEMAN_SETTINGS: CavemanSkillSettings = {
  pinByDefault: false,
  defaultIntensity: DEFAULT_CAVEMAN_INTENSITY,
};

/** Default: all skills enabled unless explicitly disabled. */
export function defaultSkillConfig(): SkillConfig {
  return { enabled: {}, caveman: { ...DEFAULT_CAVEMAN_SETTINGS } };
}

function normalizeCavemanSettings(raw: unknown): CavemanSkillSettings {
  const settings = { ...DEFAULT_CAVEMAN_SETTINGS };
  if (!raw || typeof raw !== 'object') return settings;

  const row = raw as Partial<CavemanSkillSettings>;
  if (typeof row.pinByDefault === 'boolean') {
    settings.pinByDefault = row.pinByDefault;
  }
  if (isCavemanIntensity(row.defaultIntensity)) {
    settings.defaultIntensity = row.defaultIntensity;
  }
  return settings;
}

/** Merge stored JSON with defaults. */
export function normalizeSkillConfig(raw: unknown): SkillConfig {
  const config = defaultSkillConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = raw as { enabled?: unknown; caveman?: unknown };
  if (stored.enabled && typeof stored.enabled === 'object') {
    const enabledMap = stored.enabled as Record<string, unknown>;
    for (const [id, value] of Object.entries(enabledMap)) {
      if (typeof value === 'boolean' && /^[a-z0-9][a-z0-9-]*$/.test(id)) {
        config.enabled[id] = value;
      }
    }
  }

  config.caveman = normalizeCavemanSettings(stored.caveman);
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
  cachedConfig = {
    enabled: { ...config.enabled },
    caveman: normalizeCavemanSettings(config.caveman),
  };

  if (isServerStorageMode()) {
    void putSkills(cachedConfig).catch(() => {
      setStatus('err', 'Could not save skill settings to ~/.minnow');
    });
    return;
  }

  try {
    localStorage.setItem(SKILL_CONFIG_STORAGE_KEY, JSON.stringify(cachedConfig));
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

/** Read caveman-specific settings with defaults. */
export function getCavemanSettings(): CavemanSkillSettings {
  return normalizeCavemanSettings(getSkillConfig().caveman);
}

/** Update caveman settings and persist. */
export function saveCavemanSettings(settings: Partial<CavemanSkillSettings>): void {
  const config = getSkillConfig();
  config.caveman = normalizeCavemanSettings({ ...getCavemanSettings(), ...settings });
  saveSkillConfig(config);
}

/** All valid caveman intensity labels (settings UI). */
export function listCavemanIntensityOptions(): readonly CavemanIntensity[] {
  return CAVEMAN_INTENSITIES;
}

/** Apply default caveman pin when settings request it on new chats. */
export function buildDefaultPinnedSkillForNewChat(): PinnedSkillState | null {
  const caveman = getCavemanSettings();
  if (!caveman.pinByDefault || !isSkillEnabled('caveman')) {
    return null;
  }
  return {
    id: 'caveman',
    intensity: caveman.defaultIntensity,
  };
}
