/**
 * Resolve SpeedChat user data directory (~/.speedchat) and ensure layout exists.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ALL_TOOL_IDS } from './tool-ids.js';

/** Cached resolved home path for this process. */
let cachedHome = null;

/**
 * Canonical SpeedChat home directory.
 * Override with SPEEDCHAT_HOME for tests; otherwise os.homedir() + /.speedchat.
 */
export function getSpeedChatHome() {
  if (cachedHome) return cachedHome;

  const override = process.env.SPEEDCHAT_HOME;
  if (override && typeof override === 'string' && override.trim()) {
    cachedHome = path.resolve(override.trim());
    return cachedHome;
  }

  cachedHome = path.join(os.homedir(), '.speedchat');
  return cachedHome;
}

/** Reset cached home (tests only). */
export function resetSpeedChatHomeCache() {
  cachedHome = null;
}

const SCAFFOLD_DIRS = [
  'sessions',
  'memory',
  'providers',
  'mcp',
  'lsp',
  'prompt-configs',
  'prompts',
  'skills',
  'backups',
  'logs/sub-agents',
  'logs/terminal',
  'screenshots',
];

const DEFAULT_META = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  migratedFromLocalStorage: false,
  migratedAt: null,
  localStorageKeysMigrated: [],
  layoutVersion: 1,
  activeProviderId: 'lm-studio-local',
  activePromptProfile: 'full',
  activePromptConfigId: null,
  activeInfoPresetId: 'general-assistant',
  titles: {
    enabled: true,
    modelId: '',
    providerId: '',
    maxTokens: 24,
    temperature: 0.3,
  },
  terminal: {
    open: false,
    heightPx: 240,
    autoOpenOnAgentRun: true,
  },
  browser: {
    enabled: true,
    defaultUrl: 'http://127.0.0.1:9222',
    allowNavigate: true,
    allowedOriginPatterns: [
      'http://localhost:*',
      'http://127.0.0.1:*',
      'https://localhost:*',
    ],
    screenshotDir: 'screenshots',
  },
  uiDesigner: {
    providerId: '',
    modelId: '',
    fallbackToChatModel: true,
  },
};

const DEFAULT_SYSTEM_PROMPT = {
  presetId: 'general-assistant',
  text: 'You are a helpful, concise assistant. Respond clearly and directly. Avoid unnecessary preamble.',
};

/** Tool ids enabled on first run (matches client defaultToolConfig). */
const DEFAULT_ENABLED_TOOL_IDS = new Set([
  'get_datetime',
  'calculate',
  'web_search',
  'wikipedia_search',
]);

function defaultToolsJson() {
  const enabled = {};
  for (const id of ALL_TOOL_IDS) {
    enabled[id] = DEFAULT_ENABLED_TOOL_IDS.has(id);
  }
  return { enabled, keys: { braveApiKey: '' } };
}

function defaultSessionStateJson() {
  const chatId = '00000000-0000-0000-0000-000000000001';
  return {
    version: 1,
    activeId: chatId,
    sidebarCollapsed: false,
    chats: [
      {
        id: chatId,
        name: 'New chat',
        modelId: '',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 0,
      },
    ],
  };
}

/** Best-effort restrictive permissions on Unix. */
async function chmodSafe(filePath, mode) {
  try {
    await fs.chmod(filePath, mode);
  } catch {
    /* ignore on Windows or unsupported FS */
  }
}

/**
 * Create home layout and default JSON files when missing.
 * @returns {Promise<string>} Resolved home path
 */
export async function ensureSpeedChatLayout() {
  const home = getSpeedChatHome();
  await fs.mkdir(home, { recursive: true });
  await chmodSafe(home, 0o700);

  for (const dir of SCAFFOLD_DIRS) {
    const dirPath = path.join(home, dir);
    await fs.mkdir(dirPath, { recursive: true });
    const keep = path.join(dirPath, '.gitkeep');
    try {
      await fs.access(keep);
    } catch {
      await fs.writeFile(keep, '', 'utf8');
    }
  }

  const defaults = [
    { rel: 'config.json', data: DEFAULT_META },
    { rel: 'sessions/state.json', data: defaultSessionStateJson() },
    { rel: 'tools.json', data: defaultToolsJson() },
    { rel: 'system-prompt.json', data: DEFAULT_SYSTEM_PROMPT },
  ];

  for (const { rel, data } of defaults) {
    const full = path.join(home, rel);
    try {
      await fs.access(full);
    } catch {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      if (rel === 'tools.json') {
        await chmodSafe(full, 0o600);
      }
    }
  }

  return home;
}

export { DEFAULT_META, defaultSessionStateJson, defaultToolsJson, DEFAULT_SYSTEM_PROMPT };
