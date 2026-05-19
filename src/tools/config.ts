/**
 * Tool enablement and API keys — ~/.speedchat/tools.json when npm start,
 * else localStorage (`speedchat.tools`). Settings drawer uses `data-tool-id`.
 */

import { getTools, putTools } from '../config/api-client';
import { defaultToolConfig as buildDefaultToolConfig } from '../config/defaults';
import { isServerStorageMode } from '../config/storage-mode';
import { setStatus } from '../ui/status';
import { BUILT_IN_TOOLS } from './definitions';

/** @deprecated Direct localStorage use — migration read / Vite-only fallback only. */
export const TOOL_CONFIG_STORAGE_KEY = 'speedchat.tools';

/** Persisted tool settings: per-tool enabled flags and optional keys. */
export interface ToolConfig {
  enabled: Record<string, boolean>;
  keys: {
    braveApiKey: string;
  };
}

let cachedConfig: ToolConfig | null = null;
let toolConfigLoaded = false;

/** Whether `npm start` tool server responded to ping (set by client / init). */
let localServerAvailable = false;

/** Merge stored JSON with defaults; ignore unknown shapes. */
export function normalizeToolConfig(raw: unknown): ToolConfig {
  const config = buildDefaultToolConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = raw as { enabled?: unknown; keys?: unknown };
  if (stored.enabled && typeof stored.enabled === 'object') {
    const enabledMap = stored.enabled as Record<string, unknown>;
    for (const tool of BUILT_IN_TOOLS) {
      const value = enabledMap[tool.id];
      if (typeof value === 'boolean') {
        config.enabled[tool.id] = value;
      }
    }
  }

  if (stored.keys && typeof stored.keys === 'object') {
    const keysMap = stored.keys as Record<string, unknown>;
    if (typeof keysMap.braveApiKey === 'string') {
      config.keys.braveApiKey = keysMap.braveApiKey;
    }
  }

  return config;
}

/** Load tool config from API or localStorage (call during initApp). */
export async function loadToolConfigFromStorage(): Promise<ToolConfig> {
  if (isServerStorageMode()) {
    try {
      cachedConfig = normalizeToolConfig(await getTools());
      toolConfigLoaded = true;
      return cachedConfig;
    } catch {
      setStatus('err', 'Could not load tool settings from ~/.speedchat');
    }
  }

  try {
    const raw = localStorage.getItem(TOOL_CONFIG_STORAGE_KEY);
    cachedConfig = raw
      ? normalizeToolConfig(JSON.parse(raw) as unknown)
      : buildDefaultToolConfig();
  } catch {
    cachedConfig = buildDefaultToolConfig();
  }

  toolConfigLoaded = true;
  return cachedConfig;
}

/** Read config from memory cache (loads defaults if init skipped). */
export function loadToolConfig(): ToolConfig {
  if (cachedConfig) return cachedConfig;
  if (!toolConfigLoaded) {
    void loadToolConfigFromStorage();
  }
  return buildDefaultToolConfig();
}

/** Current config (loads from storage on first access). */
export function getToolConfig(): ToolConfig {
  return loadToolConfig();
}

/** Persist config to API or localStorage. */
export function saveToolConfig(config: ToolConfig): void {
  cachedConfig = config;

  if (isServerStorageMode()) {
    void putTools(config).catch(() => {
      setStatus('err', 'Could not save tool settings to ~/.speedchat');
    });
    return;
  }

  try {
    localStorage.setItem(TOOL_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Update local tool server availability and refresh server-only rows. */
export function setLocalServerAvailable(available: boolean): void {
  localServerAvailable = available;
  refreshServerToolDisabledState();
}

/** Whether the dev tool API (`/api/tools/ping`) is reachable. */
export function isLocalServerAvailable(): boolean {
  return localServerAvailable;
}

/** True when a tool id is enabled in config (defaults applied). */
export function isToolEnabled(id: string): boolean {
  return loadToolConfig().enabled[id] === true;
}

/** Sync checkboxes and Brave key field from config; dim server tools when offline. */
export function loadToolConfigIntoDrawer(): void {
  if (typeof document === 'undefined') return;

  const config = loadToolConfig();

  const rows = document.querySelectorAll<HTMLElement>('[data-tool-id]');
  for (const row of rows) {
    const id = row.getAttribute('data-tool-id');
    if (!id) continue;

    const checkbox = row.querySelector<HTMLInputElement>(
      'input[type="checkbox"].tool-toggle, input[type="checkbox"]',
    );
    if (checkbox) {
      checkbox.checked = config.enabled[id] === true;
    }
  }

  const braveInput = document.getElementById('braveApiKey') as HTMLInputElement | null;
  if (braveInput) {
    braveInput.value = config.keys.braveApiKey;
  }

  refreshServerToolDisabledState();
}

/** Flip enabled state for one tool, persist, and update drawer UI. */
export function onToolToggle(id: string): void {
  if (typeof document === 'undefined') return;

  const config = loadToolConfig();
  const tool = BUILT_IN_TOOLS.find((entry) => entry.id === id);
  if (!tool) return;

  const nextEnabled = !config.enabled[id];
  if (tool.serverRequired && nextEnabled && !localServerAvailable) {
    const blockedRow = document.querySelector<HTMLElement>(`[data-tool-id="${id}"]`);
    const blockedCheckbox = blockedRow?.querySelector<HTMLInputElement>(
      'input[type="checkbox"].tool-toggle, input[type="checkbox"]',
    );
    if (blockedCheckbox) {
      blockedCheckbox.checked = false;
    }
    setStatus('err', 'Start with npm start to use file/git tools.');
    return;
  }

  config.enabled[id] = nextEnabled;
  saveToolConfig(config);

  const row = document.querySelector<HTMLElement>(`[data-tool-id="${id}"]`);
  const checkbox = row?.querySelector<HTMLInputElement>(
    'input[type="checkbox"].tool-toggle, input[type="checkbox"]',
  );
  if (checkbox) {
    checkbox.checked = nextEnabled;
  }

  refreshServerToolDisabledState();
}

/** Disable server-required tool rows when the local tool server is down. */
export function refreshServerToolDisabledState(): void {
  if (typeof document === 'undefined') return;

  const unavailable = !localServerAvailable;

  const banner = document.getElementById('toolsServerBanner');
  if (banner) {
    banner.classList.toggle('hidden', !unavailable);
  }

  const serverRows = document.querySelectorAll<HTMLElement>(
    '.tool-row[data-server-required], [data-tool-id][data-server-required]',
  );

  for (const row of serverRows) {
    row.classList.toggle('is-server-unavailable', unavailable);
    const checkbox = row.querySelector<HTMLInputElement>(
      'input[type="checkbox"].tool-toggle, input[type="checkbox"]',
    );
    if (!checkbox) continue;

    checkbox.disabled = unavailable;
    if (unavailable) {
      checkbox.setAttribute(
        'title',
        'Requires npm start — local tool server is not running',
      );
    } else {
      checkbox.removeAttribute('title');
    }
  }
}

/** Persist Brave API key from the settings drawer (call on input/blur). */
export function saveBraveApiKeyFromDrawer(): void {
  const input = document.getElementById('braveApiKey') as HTMLInputElement | null;
  if (!input) return;

  const config = loadToolConfig();
  config.keys.braveApiKey = input.value.trim();
  saveToolConfig(config);
}
