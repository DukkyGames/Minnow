/**
 * Resolve Minnow user data directory (~/.minnow) and ensure layout exists.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ALL_TOOL_IDS } from './tool-ids.js';

/** Cached resolved home path for this process. */
let cachedHome = null;

const LEGACY_DIR_NAME = '.speedchat';
const HOME_DIR_NAME = '.minnow';

/**
 * Canonical Minnow home directory.
 * Override with MINNOW_HOME (or legacy SPEEDCHAT_HOME) for tests; otherwise ~/.minnow.
 * Renames ~/.speedchat → ~/.minnow on first run when only the legacy folder exists.
 */
export function getMinnowHome() {
  if (cachedHome) return cachedHome;

  const override =
    (typeof process.env.MINNOW_HOME === 'string' && process.env.MINNOW_HOME.trim()) ||
    (typeof process.env.SPEEDCHAT_HOME === 'string' && process.env.SPEEDCHAT_HOME.trim());
  if (override) {
    cachedHome = path.resolve(override);
    return cachedHome;
  }

  const home = path.join(os.homedir(), HOME_DIR_NAME);
  const legacy = path.join(os.homedir(), LEGACY_DIR_NAME);
  if (!fs.existsSync(home) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, home);
    } catch {
      cachedHome = legacy;
      return cachedHome;
    }
  }

  cachedHome = home;
  return cachedHome;
}

/** Reset cached home (tests only). */
export function resetMinnowHomeCache() {
  cachedHome = null;
}

/** @deprecated Use getMinnowHome */
export const getSpeedChatHome = getMinnowHome;

/** @deprecated Use resetMinnowHomeCache */
export const resetSpeedChatHomeCache = resetMinnowHomeCache;

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
  selfHealing: {
    enabled: false,
    tier1: {
      maxRestartsPerParentTurn: 2,
      duplicateToolCallThreshold: 3,
      sameErrorThreshold: 3,
      noProgressTurnThreshold: 4,
    },
    tier2: {
      enabled: true,
      requireScriptApproval: true,
    },
  },
  memory: {
    enabled: true,
    maxEntries: 500,
    maxInjectCharsFull: 4000,
    maxInjectCharsLite: 800,
    retrieveLimit: 20,
    defaultTags: [],
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

/** Per-skill enable flags; missing ids default to enabled. */
function defaultSkillsJson() {
  return { enabled: {} };
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
    await fsp.chmod(filePath, mode);
  } catch {
    /* ignore on Windows or unsupported FS */
  }
}

/**
 * Create home layout and default JSON files when missing.
 * @returns {Promise<string>} Resolved home path
 */
export async function ensureMinnowLayout() {
  const home = getMinnowHome();
  await fsp.mkdir(home, { recursive: true });
  await chmodSafe(home, 0o700);

  for (const dir of SCAFFOLD_DIRS) {
    const dirPath = path.join(home, dir);
    await fsp.mkdir(dirPath, { recursive: true });
    const keep = path.join(dirPath, '.gitkeep');
    try {
      await fsp.access(keep);
    } catch {
      await fsp.writeFile(keep, '', 'utf8');
    }
  }

  const defaults = [
    { rel: 'config.json', data: DEFAULT_META },
    { rel: 'sessions/state.json', data: defaultSessionStateJson() },
    { rel: 'tools.json', data: defaultToolsJson() },
    { rel: 'skills.json', data: defaultSkillsJson() },
    { rel: 'system-prompt.json', data: DEFAULT_SYSTEM_PROMPT },
  ];

  for (const { rel, data } of defaults) {
    const full = path.join(home, rel);
    try {
      await fsp.access(full);
    } catch {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      if (rel === 'tools.json') {
        await chmodSafe(full, 0o600);
      }
    }
  }

  return home;
}

/** @deprecated Use ensureMinnowLayout */
export const ensureSpeedChatLayout = ensureMinnowLayout;

export {
  DEFAULT_META,
  defaultSessionStateJson,
  defaultToolsJson,
  defaultSkillsJson,
  DEFAULT_SYSTEM_PROMPT,
};
