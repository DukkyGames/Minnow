/**
 * Tool enablement and API keys — ~/.minnow/tools.json when npm start,
 * else localStorage (`minnow.tools`). Settings drawer uses `data-tool-id`.
 */

import { getTools, putTools } from '../config/api-client';
import { defaultToolConfig as buildDefaultToolConfig } from '../config/defaults';
import { isServerStorageMode } from '../config/storage-mode';
import { setStatus } from '../ui/status';
import { BUILT_IN_TOOLS, type ToolCategory } from './definitions';
import {
  createEmptyToolPermissionsConfig,
  type ApprovalPattern,
  type ToolAgentKey,
  type ToolConfig,
  type ToolPermissionMode,
  type ToolPermissionsConfig,
} from './tool-settings-types';
import { MAX_APPROVAL_PATTERNS } from './permission-resolve';
import { DEFAULT_REGISTRY_IDS } from '../agents/work-agent-registry';
import DEFAULT_SUB_AGENTS from '../agents/defaults/sub-agents.json';

export type {
  ApprovalPattern,
  ToolAgentKey,
  ToolConfig,
  ToolPermissionMode,
  ToolPermissionsConfig,
} from './tool-settings-types';

export { defaultToolConfig } from '../config/defaults';

/** @deprecated Direct localStorage use — migration read / Vite-only fallback only. */
export const TOOL_CONFIG_STORAGE_KEY = 'minnow.tools';

const PERMISSION_SET = new Set<ToolPermissionMode>(['full', 'ask', 'off']);

const PATTERN_MATCH_SET = new Set<ApprovalPattern['match']>(['startsWith', 'equals']);

/** True when `value` is a valid stored permission string. */
export function isToolPermissionMode(value: unknown): value is ToolPermissionMode {
  return typeof value === 'string' && PERMISSION_SET.has(value as ToolPermissionMode);
}

export { createEmptyToolPermissionsConfig } from './tool-settings-types';

/** True when persisted `permissions` is the legacy flat toolId → mode map. */
export function isLegacyFlatPermissions(permissions: unknown): boolean {
  if (!permissions || typeof permissions !== 'object') return false;
  const obj = permissions as Record<string, unknown>;
  if (obj.default && typeof obj.default === 'object' && !Array.isArray(obj.default)) {
    return false;
  }
  for (const value of Object.values(obj)) {
    if (isToolPermissionMode(value)) return true;
  }
  return false;
}

function normalizeApprovalPattern(raw: unknown): ApprovalPattern | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const toolId = typeof row.toolId === 'string' ? row.toolId.trim() : '';
  const agentScope =
    row.agentScope === '*' ?
      '*'
    : typeof row.agentScope === 'string' ?
      row.agentScope.trim()
    : '';
  const argPath = typeof row.argPath === 'string' ? row.argPath.trim() : '';
  const match = row.match;
  const value = typeof row.value === 'string' ? row.value : '';
  if (!id || !toolId || !agentScope || !argPath || !value) return null;
  if (!PATTERN_MATCH_SET.has(match as ApprovalPattern['match'])) return null;
  return {
    id,
    toolId,
    agentScope,
    argPath,
    match: match as ApprovalPattern['match'],
    value,
  };
}

/** Validates and caps pattern rows from storage. */
export function normalizeApprovalPatterns(raw: unknown): ApprovalPattern[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalPattern[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_APPROVAL_PATTERNS) break;
    const pattern = normalizeApprovalPattern(item);
    if (!pattern || seen.has(pattern.id)) continue;
    seen.add(pattern.id);
    out.push(pattern);
  }
  return out;
}

function normalizePerAgentMap(raw: unknown): ToolPermissionsConfig['perAgent'] {
  const out: ToolPermissionsConfig['perAgent'] = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [agentKey, toolsRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!agentKey.trim() || !toolsRaw || typeof toolsRaw !== 'object') continue;
    const tools: Record<string, ToolPermissionMode> = {};
    for (const [toolId, mode] of Object.entries(toolsRaw as Record<string, unknown>)) {
      if (!toolId || !isToolPermissionMode(mode)) continue;
      tools[toolId] = mode;
    }
    if (Object.keys(tools).length > 0) {
      out[agentKey.trim()] = tools;
    }
  }
  return out;
}

/** Merges legacy flat or v2 stored permissions into {@link ToolPermissionsConfig}. */
export function normalizePermissionsFromStored(
  stored: unknown,
  seedDefault: Record<string, ToolPermissionMode>,
): ToolPermissionsConfig {
  if (!stored || typeof stored !== 'object') {
    return { default: { ...seedDefault }, perAgent: {}, patterns: [] };
  }

  if (isLegacyFlatPermissions(stored)) {
    const flat = stored as Record<string, unknown>;
    const merged = { ...seedDefault };
    for (const [id, value] of Object.entries(flat)) {
      if (!id || !isToolPermissionMode(value)) continue;
      merged[id] = value;
    }
    return { default: merged, perAgent: {}, patterns: [] };
  }

  const obj = stored as Record<string, unknown>;
  const defaultRaw = obj.default;
  const merged = { ...seedDefault };
  if (defaultRaw && typeof defaultRaw === 'object') {
    for (const [id, value] of Object.entries(defaultRaw as Record<string, unknown>)) {
      if (!id || !isToolPermissionMode(value)) continue;
      merged[id] = value;
    }
  }

  return {
    default: merged,
    perAgent: normalizePerAgentMap(obj.perAgent),
    patterns: normalizeApprovalPatterns(obj.patterns),
  };
}

/** Agent keys for settings matrix (main, work agents, sub-agent types). */
export function listKnownAgentKeys(): ToolAgentKey[] {
  const keys = new Set<ToolAgentKey>(['main', '*']);
  for (const id of DEFAULT_REGISTRY_IDS) {
    keys.add(`work-agent:${id}`);
  }
  const subTypes = DEFAULT_SUB_AGENTS as { types?: Record<string, unknown> };
  if (subTypes.types) {
    for (const typeId of Object.keys(subTypes.types)) {
      keys.add(`sub-agent:${typeId}`);
    }
  }
  return [...keys].sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return a.localeCompare(b);
  });
}

/** Sets a per-agent override (sparse); does not enable globally `off` tools. */
export function setAgentToolPermission(
  config: ToolConfig,
  agentKey: ToolAgentKey,
  toolId: string,
  mode: ToolPermissionMode,
): void {
  if (!config.permissions.perAgent[agentKey]) {
    config.permissions.perAgent[agentKey] = {};
  }
  config.permissions.perAgent[agentKey][toolId] = mode;
}

/** Appends a pattern row when under the cap. */
export function addApprovalPattern(config: ToolConfig, pattern: ApprovalPattern): boolean {
  if (config.permissions.patterns.length >= MAX_APPROVAL_PATTERNS) return false;
  if (config.permissions.patterns.some((p) => p.id === pattern.id)) return false;
  config.permissions.patterns.push(pattern);
  return true;
}

/** Removes a pattern by id. */
export function removeApprovalPattern(config: ToolConfig, patternId: string): boolean {
  const before = config.permissions.patterns.length;
  config.permissions.patterns = config.permissions.patterns.filter((p) => p.id !== patternId);
  return config.permissions.patterns.length < before;
}

/**
 * Normalizes built-in `permissions` entries and mirrors `enabled` for those ids.
 * Leaves unrelated keys (for example MCP tool names) unchanged.
 */
export function syncEnabledFromPermissions(config: ToolConfig): void {
  for (const tool of BUILT_IN_TOOLS) {
    const raw = config.permissions.default[tool.id];
    const mode: ToolPermissionMode = isToolPermissionMode(raw)
      ? raw
      : config.enabled[tool.id] === true
        ? 'ask'
        : 'off';
    config.permissions.default[tool.id] = mode;
    config.enabled[tool.id] = mode !== 'off';
  }
}

/**
 * Effective permission for a tool id: stored value, or `ask` for unknown MCP-style ids,
 * or derived default for built-ins when missing.
 */
export function getToolPermissionForId(
  config: ToolConfig,
  id: string,
): ToolPermissionMode {
  const raw = config.permissions.default[id];
  if (isToolPermissionMode(raw)) return raw;
  if (id.startsWith('mcp__') || id.startsWith('plugin__')) return 'ask';
  if (id === 'web_search_ddg') {
    return getToolPermissionForId(config, 'web_search');
  }
  const tool = BUILT_IN_TOOLS.find((t) => t.id === id);
  if (!tool) return 'off';
  return config.enabled[id] === true ? 'ask' : 'off';
}

let cachedConfig: ToolConfig | null = null;
let toolConfigLoaded = false;

/** Set when `GET /api/config/tools` fails in server mode; cleared on success. */
let serverToolsFetchFailed = false;

/** Deduplicate overlapping {@link loadToolConfigFromStorage} calls (settings refresh + init). */
let loadFromStoragePromise: Promise<ToolConfig> | null = null;

/** Whether `npm start` tool server responded to ping (set by client / init). */
let localServerAvailable = false;

/** Merge stored JSON with defaults; ignore unknown shapes. */
export function normalizeToolConfig(raw: unknown): ToolConfig {
  const config = buildDefaultToolConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = raw as {
    enabled?: unknown;
    keys?: unknown;
    permissions?: unknown;
    toolCache?: unknown;
  };
  if (stored.enabled && typeof stored.enabled === 'object') {
    const enabledMap = stored.enabled as Record<string, unknown>;
    for (const tool of BUILT_IN_TOOLS) {
      const value = enabledMap[tool.id];
      if (typeof value === 'boolean') {
        config.enabled[tool.id] = value;
      }
    }
  }

  let hadPermissionsInFile = false;
  if (stored.permissions && typeof stored.permissions === 'object') {
    hadPermissionsInFile =
      isLegacyFlatPermissions(stored.permissions) ||
      (typeof (stored.permissions as Record<string, unknown>).default === 'object' &&
        (stored.permissions as Record<string, unknown>).default !== null);
    config.permissions = normalizePermissionsFromStored(
      stored.permissions,
      config.permissions.default,
    );
  }

  if (!hadPermissionsInFile) {
    for (const tool of BUILT_IN_TOOLS) {
      config.permissions.default[tool.id] =
        config.enabled[tool.id] === true ? 'ask' : 'off';
    }
  } else {
    for (const tool of BUILT_IN_TOOLS) {
      if (!isToolPermissionMode(config.permissions.default[tool.id])) {
        config.permissions.default[tool.id] =
          config.enabled[tool.id] === true ? 'ask' : 'off';
      }
    }
  }

  syncEnabledFromPermissions(config);

  if (stored.keys && typeof stored.keys === 'object') {
    const keysMap = stored.keys as Record<string, unknown>;
    if (typeof keysMap.braveApiKey === 'string') {
      config.keys.braveApiKey = keysMap.braveApiKey;
    }
  }

  if (stored.toolCache && typeof stored.toolCache === 'object') {
    const cacheMap = stored.toolCache as Record<string, unknown>;
    if (typeof cacheMap.enabled === 'boolean') {
      config.toolCache = { enabled: cacheMap.enabled };
    }
  }
  if (!config.toolCache) {
    config.toolCache = { enabled: true };
  }

  return config;
}

/** Clear in-memory tool config so the next load re-reads persistence. */
export function invalidateToolConfigCache(): void {
  cachedConfig = null;
  toolConfigLoaded = false;
  loadFromStoragePromise = null;
}

/** Load tool config from API or localStorage (call during initApp). */
export async function loadToolConfigFromStorage(): Promise<ToolConfig> {
  if (loadFromStoragePromise) return loadFromStoragePromise;

  loadFromStoragePromise = (async (): Promise<ToolConfig> => {
    try {
      if (isServerStorageMode()) {
        try {
          cachedConfig = normalizeToolConfig(await getTools());
          serverToolsFetchFailed = false;
          toolConfigLoaded = true;
          return cachedConfig;
        } catch {
          serverToolsFetchFailed = true;
          setStatus('err', 'Could not load tool settings from ~/.minnow');
          // Do not fall back to browser localStorage in server mode — stale empty
          // minnow.tools would show every tool as Disabled on the settings page.
          cachedConfig = cachedConfig ?? buildDefaultToolConfig();
          toolConfigLoaded = true;
          return cachedConfig;
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
    } catch {
      cachedConfig = buildDefaultToolConfig();
      toolConfigLoaded = true;
      return cachedConfig;
    } finally {
      loadFromStoragePromise = null;
    }
  })();

  return loadFromStoragePromise;
}

/**
 * Load tool config for Settings → Tools without re-fetching on every visit.
 * Retries once when the initial server-mode fetch failed during app boot.
 */
export async function loadToolConfigForSettingsUi(): Promise<ToolConfig> {
  if (cachedConfig !== null && !serverToolsFetchFailed) {
    return cachedConfig;
  }
  if (serverToolsFetchFailed) {
    invalidateToolConfigCache();
  }
  return loadToolConfigFromStorage();
}

/** True when settings UI can hydrate from memory without a network round-trip. */
export function isToolConfigReadyForSettingsUi(): boolean {
  return cachedConfig !== null && !serverToolsFetchFailed;
}

/**
 * Ensures tool config is loaded before permission checks (avoids treating tools as `ask`
 * when `executeTool` runs before `initApp` finishes loading `tools.json`).
 */
export async function ensureToolConfigReady(): Promise<ToolConfig> {
  if (cachedConfig !== null) return cachedConfig;
  return loadToolConfigFromStorage();
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

/** Override in-memory tool config (headless tests). */
export function setToolConfigForTests(config: ToolConfig): void {
  cachedConfig = config;
  toolConfigLoaded = true;
}

/** Persist config to API or localStorage; server write is best-effort (see {@link saveToolConfigAsync}). */
export function saveToolConfig(config: ToolConfig): void {
  void saveToolConfigAsync(config).catch(() => {
    if (isServerStorageMode()) {
      setStatus('err', 'Could not save tool settings to ~/.minnow');
    }
  });
}

/**
 * Persists tool config and awaits the network round-trip when using `npm start`
 * so a full reload does not race ahead of the completed `PUT /api/config/tools`.
 */
export async function saveToolConfigAsync(config: ToolConfig): Promise<void> {
  syncEnabledFromPermissions(config);
  cachedConfig = config;

  if (isServerStorageMode()) {
    try {
      await putTools(config);
    } catch {
      setStatus('err', 'Could not save tool settings to ~/.minnow');
    }
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
  return getToolPermissionForId(loadToolConfig(), id) !== 'off';
}

/** Sync permission selects and Brave key field from config; dim server tools when offline. */
export function loadToolConfigIntoDrawer(
  root: ParentNode = document,
): void {
  if (typeof document === 'undefined') return;

  const config = loadToolConfig();

  const rows = root.querySelectorAll<HTMLElement>('[data-tool-id]');
  for (const row of rows) {
    const id = row.getAttribute('data-tool-id');
    if (!id) continue;

    const select = row.querySelector<HTMLSelectElement>('select.tool-permission-select');
    if (select) {
      select.value = getToolPermissionForId(config, id);
    }
  }

  const braveInput = document.getElementById('braveApiKey') as HTMLInputElement | null;
  if (braveInput) {
    braveInput.value = config.keys.braveApiKey;
  }

  refreshServerToolDisabledState();
  syncToolSelectAllControls(root);
}

/** Tool ids that can be enabled right now (server tools only when npm start is up). */
export function getEligibleToolIds(ids: string[]): string[] {
  return ids.filter((id) => {
    const tool = BUILT_IN_TOOLS.find((entry) => entry.id === id);
    if (!tool) return false;
    if (tool.previewRequired) {
      return typeof window !== 'undefined' && Boolean(window.minnow?.preview);
    }
    return !tool.serverRequired || localServerAvailable;
  });
}

/** Checked / indeterminate state for a bulk "select all" control over `ids`. */
export function getToolBulkCheckboxState(ids: string[]): {
  checked: boolean;
  indeterminate: boolean;
} {
  const config = loadToolConfig();
  const eligible = getEligibleToolIds(ids);
  if (eligible.length === 0) {
    return { checked: false, indeterminate: false };
  }

  const enabledCount = eligible.filter((id) => getToolPermissionForId(config, id) !== 'off')
    .length;
  if (enabledCount === 0) {
    return { checked: false, indeterminate: false };
  }
  if (enabledCount === eligible.length) {
    return { checked: true, indeterminate: false };
  }
  return { checked: false, indeterminate: true };
}

/** Apply enabled flag to many tools, persist, and refresh list UI under `root`. */
export function setToolsEnabled(
  ids: string[],
  enabled: boolean,
  root: ParentNode = document,
): { applied: number; skipped: number } {
  const config = loadToolConfig();
  let applied = 0;
  let skipped = 0;

  for (const id of ids) {
    const tool = BUILT_IN_TOOLS.find((entry) => entry.id === id);
    if (!tool) continue;

    if (enabled && tool.previewRequired && typeof window !== 'undefined' && !window.minnow?.preview) {
      skipped += 1;
      continue;
    }

    if (enabled && tool.serverRequired && !localServerAvailable) {
      skipped += 1;
      continue;
    }

    if (enabled) {
      if (getToolPermissionForId(config, id) !== 'off') continue;
    } else if (getToolPermissionForId(config, id) === 'off') {
      continue;
    }
    config.permissions.default[id] = enabled ? 'ask' : 'off';
    applied += 1;
  }

  if (applied > 0) {
    syncEnabledFromPermissions(config);
    saveToolConfig(config);
  }

  refreshAllToolListUis(root);

  if (enabled && skipped > 0) {
    setStatus('err', 'Start with npm start to use file/git tools.');
  }

  return { applied, skipped };
}

/** Pure: set every built-in catalog tool to `mode` and mirror `enabled`. */
export function applyAllBuiltInToolPermissions(
  config: ToolConfig,
  mode: ToolPermissionMode,
): ToolConfig {
  for (const tool of BUILT_IN_TOOLS) {
    config.permissions.default[tool.id] = mode;
  }
  syncEnabledFromPermissions(config);
  return config;
}

/** Pure: restore built-in permissions/enabled from defaults; keep keys and non-catalog ids. */
export function applyDefaultBuiltInPermissions(config: ToolConfig): ToolConfig {
  const defaults = buildDefaultToolConfig();
  for (const tool of BUILT_IN_TOOLS) {
    config.permissions.default[tool.id] = defaults.permissions.default[tool.id] ?? 'off';
    config.enabled[tool.id] = defaults.enabled[tool.id] ?? false;
  }
  syncEnabledFromPermissions(config);
  return config;
}

/** Refresh permission selects and bulk checkboxes on every mounted tool list. */
export function refreshAllToolListUis(_root: ParentNode = document): void {
  if (typeof document === 'undefined') return;

  loadToolConfigIntoDrawer(document);

  for (const listId of ['toolsList', 'settingsToolsList', 'composerToolsList'] as const) {
    const list = document.getElementById(listId);
    if (list) {
      syncToolSelectAllControls(list);
    }
  }
}

/** Set every built-in tool to `mode`, persist, and refresh all tool list UIs. */
export async function setAllBuiltInToolPermissions(
  mode: ToolPermissionMode,
  root: ParentNode = document,
): Promise<{ updated: number }> {
  const config = loadToolConfig();
  applyAllBuiltInToolPermissions(config, mode);
  await saveToolConfigAsync(config);
  refreshAllToolListUis(root);
  return { updated: BUILT_IN_TOOLS.length };
}

/** Restore built-in permissions to factory defaults, persist, and refresh lists. */
export async function resetBuiltInToolPermissionsToDefaults(
  root: ParentNode = document,
): Promise<void> {
  const config = loadToolConfig();
  applyDefaultBuiltInPermissions(config);
  await saveToolConfigAsync(config);
  refreshAllToolListUis(root);
}

/** Set one built-in tool permission mode and refresh UI. */
export function setToolPermission(
  id: string,
  mode: ToolPermissionMode,
  root: ParentNode = document,
): void {
  const tool = BUILT_IN_TOOLS.find((entry) => entry.id === id);
  if (!tool) return;

  if (mode !== 'off' && tool.previewRequired && typeof window !== 'undefined' && !window.minnow?.preview) {
    setStatus('err', 'Browser tools require the Minnow desktop shell (Electron).');
    refreshAllToolListUis(root);
    return;
  }

  if (mode !== 'off' && tool.serverRequired && !localServerAvailable) {
    setStatus('err', 'Start with npm start to use file/git tools.');
    refreshAllToolListUis(root);
    return;
  }

  const config = loadToolConfig();
  config.permissions.default[id] = mode;
  syncEnabledFromPermissions(config);
  saveToolConfig(config);

  refreshAllToolListUis(root);
}

/** All built-in tool ids in a settings category. */
export function getToolIdsForCategory(category: ToolCategory): string[] {
  return BUILT_IN_TOOLS.filter((tool) => tool.category === category).map(
    (tool) => tool.id,
  );
}

/** Update global and per-category "select all" checkboxes under `root`. */
export function syncToolSelectAllControls(root: ParentNode = document): void {
  if (typeof document === 'undefined') return;

  const applyState = (checkbox: HTMLInputElement, ids: string[]) => {
    const { checked, indeterminate } = getToolBulkCheckboxState(ids);
    checkbox.checked = checked;
    checkbox.indeterminate = indeterminate;
  };

  const global = root.querySelector<HTMLInputElement>(
    'input[type="checkbox"][data-select-all="global"]',
  );
  if (global) {
    applyState(global, BUILT_IN_TOOLS.map((tool) => tool.id));
  }

  const categoryBoxes = root.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-select-all-category]',
  );
  for (const checkbox of categoryBoxes) {
    const category = checkbox.getAttribute('data-select-all-category');
    if (!category) continue;
    applyState(checkbox, getToolIdsForCategory(category as ToolCategory));
  }
}

/** Flip enabled state for one tool, persist, and update drawer UI. */
export function onToolToggle(id: string): void {
  if (typeof document === 'undefined') return;

  const config = loadToolConfig();
  const tool = BUILT_IN_TOOLS.find((entry) => entry.id === id);
  if (!tool) return;

  const currentlyOn = getToolPermissionForId(config, id) !== 'off';
  const nextMode: ToolPermissionMode = currentlyOn ? 'off' : 'ask';
  setToolPermission(id, nextMode, document);
}

/** Disable server-required tool rows when the local tool server is down. */
export function refreshServerToolDisabledState(): void {
  if (typeof document === 'undefined') return;

  const unavailable = !localServerAvailable;

  const banner = document.getElementById('toolsServerBanner');
  if (banner) {
    banner.classList.toggle('hidden', !unavailable);
  }

  const settingsBanner = document.getElementById('settingsToolsServerBanner');
  if (settingsBanner) {
    settingsBanner.classList.toggle('hidden', !unavailable);
  }

  const composerBanner = document.getElementById('composerToolsServerBanner');
  if (composerBanner) {
    composerBanner.classList.toggle('hidden', !unavailable);
  }

  const serverRows = document.querySelectorAll<HTMLElement>(
    '.tool-row[data-server-required], [data-tool-id][data-server-required]',
  );

  for (const row of serverRows) {
    row.classList.toggle('is-server-unavailable', unavailable);
    const select = row.querySelector<HTMLSelectElement>('select.tool-permission-select');
    if (select) {
      select.disabled = unavailable;
      if (unavailable) {
        select.setAttribute(
          'title',
          'Requires npm start — local tool server is not running',
        );
      } else {
        select.removeAttribute('title');
      }
    }
  }

  syncToolSelectAllControls(document);
}

/** Persist Brave API key from the settings drawer (call on input/blur). */
export function saveBraveApiKeyFromDrawer(): void {
  const input = document.getElementById('braveApiKey') as HTMLInputElement | null;
  if (!input) return;

  const config = loadToolConfig();
  config.keys.braveApiKey = input.value.trim();
  saveToolConfig(config);
}
