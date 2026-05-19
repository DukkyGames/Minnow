/**
 * Load browser automation settings from ~/.speedchat/config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getSpeedChatHome } from '../config/home.js';

/** @typedef {object} BrowserConfig
 * @property {boolean} enabled
 * @property {string} defaultUrl
 * @property {boolean} allowNavigate
 * @property {string[]} allowedOriginPatterns
 * @property {string} screenshotDir
 */

export const DEFAULT_BROWSER_CONFIG = {
  enabled: true,
  defaultUrl: 'http://127.0.0.1:9222',
  allowNavigate: true,
  allowedOriginPatterns: [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://localhost:*',
  ],
  screenshotDir: 'screenshots',
};

let cachedConfig = null;
let cachedMtime = 0;

/**
 * @param {unknown} raw
 * @returns {BrowserConfig}
 */
function mergeBrowserConfig(raw) {
  const base = { ...DEFAULT_BROWSER_CONFIG, allowedOriginPatterns: [...DEFAULT_BROWSER_CONFIG.allowedOriginPatterns] };
  if (!raw || typeof raw !== 'object') return base;
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (typeof row.enabled === 'boolean') base.enabled = row.enabled;
  if (typeof row.defaultUrl === 'string' && row.defaultUrl.trim()) {
    base.defaultUrl = row.defaultUrl.trim();
  }
  if (typeof row.allowNavigate === 'boolean') base.allowNavigate = row.allowNavigate;
  if (Array.isArray(row.allowedOriginPatterns)) {
    base.allowedOriginPatterns = row.allowedOriginPatterns.filter((p) => typeof p === 'string');
  }
  if (typeof row.screenshotDir === 'string' && row.screenshotDir.trim()) {
    base.screenshotDir = row.screenshotDir.trim();
  }
  return base;
}

/**
 * Read browser section from config.json (cached by mtime).
 * @returns {Promise<BrowserConfig>}
 */
export async function loadBrowserConfig() {
  const configPath = path.join(getSpeedChatHome(), 'config.json');
  try {
    const stat = await fs.stat(configPath);
    if (cachedConfig && stat.mtimeMs === cachedMtime) {
      return cachedConfig;
    }
    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    cachedConfig = mergeBrowserConfig(raw?.browser);
    cachedMtime = stat.mtimeMs;
    return cachedConfig;
  } catch {
    cachedConfig = mergeBrowserConfig(null);
    cachedMtime = 0;
    return cachedConfig;
  }
}

/** Reset cache (tests). */
export function resetBrowserConfigCache() {
  cachedConfig = null;
  cachedMtime = 0;
}

/**
 * Resolve CDP HTTP endpoint: arg → env → config → default.
 * @param {Record<string, unknown>} [args]
 */
export async function resolveBrowserUrl(args = {}) {
  const fromArg =
    typeof args.browser_url === 'string' && args.browser_url.trim()
      ? args.browser_url.trim()
      : '';
  if (fromArg) return fromArg;

  const fromEnv =
    typeof process.env.SPEEDCHAT_BROWSER_URL === 'string' &&
    process.env.SPEEDCHAT_BROWSER_URL.trim()
      ? process.env.SPEEDCHAT_BROWSER_URL.trim()
      : '';
  if (fromEnv) return fromEnv;

  const cfg = await loadBrowserConfig();
  return cfg.defaultUrl;
}

/**
 * @param {BrowserConfig} cfg
 */
export async function assertBrowserEnabled(cfg) {
  if (!cfg.enabled) {
    throw new Error('browser automation is disabled in settings');
  }
}
