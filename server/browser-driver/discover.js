import fs from 'node:fs/promises';
import path from 'node:path';

import { loadBrowserConfig } from '../cdp/browser-config.js';

/**
 * @typedef {'chrome' | 'chrome-canary' | 'edge' | 'brave' | 'chromium'} BrowserFamily
 * @typedef {object} BrowserCandidate
 * @property {string} executablePath
 * @property {BrowserFamily} family
 * @typedef {object} BrowserCapabilityAvailable
 * @property {true} available
 * @property {string} executablePath
 * @property {BrowserFamily} family
 * @property {'env' | 'probe'} source
 * @typedef {object} BrowserCapabilityUnavailable
 * @property {false} available
 * @property {'disabled-in-settings' | 'no-chromium-browser' | 'env-path-missing'} reason
 * @property {string} detail
 * @property {string[]} searched
 * @typedef {BrowserCapabilityAvailable | BrowserCapabilityUnavailable} BrowserCapability
 */

export const BROWSER_PATH_ENV = 'MINNOW_BROWSER_PATH';

/**
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @returns {BrowserCandidate[]}
 */
export function browserCandidates(platform, env = {}) {
  /** @type {BrowserCandidate[]} */
  const out = [];
  /**
   * @param {string | undefined} base
   * @param {string[]} parts
   * @param {BrowserFamily} family
   */
  const push = (base, parts, family) => {
    if (!base) return;
    out.push({ executablePath: path.join(base, ...parts), family });
  };

  if (platform === 'win32') {
    const programFiles = env.PROGRAMFILES ?? env.ProgramFiles;
    const programFilesX86 = env['PROGRAMFILES(X86)'] ?? env['ProgramFiles(x86)'];
    const localAppData = env.LOCALAPPDATA;
    for (const base of [programFiles, programFilesX86, localAppData]) {
      push(base, ['Google', 'Chrome', 'Application', 'chrome.exe'], 'chrome');
    }
    push(localAppData, ['Google', 'Chrome SxS', 'Application', 'chrome.exe'], 'chrome-canary');
    for (const base of [programFilesX86, programFiles, localAppData]) {
      push(base, ['Microsoft', 'Edge', 'Application', 'msedge.exe'], 'edge');
    }
    for (const base of [programFiles, programFilesX86, localAppData]) {
      push(base, ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], 'brave');
    }
    for (const base of [programFiles, programFilesX86, localAppData]) {
      push(base, ['Chromium', 'Application', 'chrome.exe'], 'chromium');
    }
    return out;
  }

  if (platform === 'darwin') {
    const apps = '/Applications';
    const userApps = env.HOME ? path.join(env.HOME, 'Applications') : undefined;
    for (const base of [apps, userApps]) {
      push(base, ['Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'], 'chrome');
    }
    push(apps, ['Google Chrome Canary.app', 'Contents', 'MacOS', 'Google Chrome Canary'], 'chrome-canary');
    push(apps, ['Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'], 'edge');
    push(apps, ['Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'], 'brave');
    push(apps, ['Chromium.app', 'Contents', 'MacOS', 'Chromium'], 'chromium');
    return out;
  }

  const linux = /** @type {[string, BrowserFamily][]} */ ([
    ['/usr/bin/google-chrome', 'chrome'],
    ['/usr/bin/google-chrome-stable', 'chrome'],
    ['/opt/google/chrome/chrome', 'chrome'],
    ['/usr/bin/microsoft-edge', 'edge'],
    ['/usr/bin/microsoft-edge-stable', 'edge'],
    ['/usr/bin/brave-browser', 'brave'],
    ['/usr/bin/chromium', 'chromium'],
    ['/usr/bin/chromium-browser', 'chromium'],
    ['/snap/bin/chromium', 'chromium'],
  ]);
  for (const [executablePath, family] of linux) out.push({ executablePath, family });
  return out;
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function isExecutableFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} executablePath
 * @returns {BrowserFamily}
 */
export function familyFromPath(executablePath) {
  const base = path.basename(executablePath).toLowerCase();
  const full = executablePath.toLowerCase();
  if (base.includes('msedge') || full.includes('edge')) return 'edge';
  if (base.includes('brave') || full.includes('brave')) return 'brave';
  if (full.includes('canary') || full.includes('chrome sxs')) return 'chrome-canary';
  if (full.includes('chromium')) return 'chromium';
  return 'chrome';
}

/**
 * @param {object} [opts]
 * @param {string} [opts.platform]
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {string} [opts.executablePath]
 * @returns {Promise<BrowserCapability>}
 */
export async function discoverBrowser(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  const explicit = String(opts.executablePath ?? env[BROWSER_PATH_ENV] ?? '').trim();
  if (explicit) {
    if (await isExecutableFile(explicit)) {
      return {
        available: true,
        executablePath: explicit,
        family: familyFromPath(explicit),
        source: 'env',
      };
    }
    return {
      available: false,
      reason: 'env-path-missing',
      detail: `${opts.executablePath ? 'executablePath' : BROWSER_PATH_ENV} points at "${explicit}", which is not a file`,
      searched: [explicit],
    };
  }

  const candidates = browserCandidates(platform, env);
  /** @type {string[]} */
  const searched = [];
  for (const candidate of candidates) {
    searched.push(candidate.executablePath);
    if (await isExecutableFile(candidate.executablePath)) {
      return {
        available: true,
        executablePath: candidate.executablePath,
        family: candidate.family,
        source: 'probe',
      };
    }
  }

  return {
    available: false,
    reason: 'no-chromium-browser',
    detail:
      'No Chrome, Edge, Brave, or Chromium executable was found. ' +
      `Install one, or set ${BROWSER_PATH_ENV} to an executable.`,
    searched,
  };
}

/**
 * @param {object} [opts]
 * @returns {Promise<BrowserCapability>}
 */
export async function probeBrowserCapability(opts = {}) {
  let enabled = true;
  try {
    const cfg = await loadBrowserConfig();
    enabled = cfg.enabled !== false;
  } catch {
    enabled = true;
  }
  if (!enabled) {
    return {
      available: false,
      reason: 'disabled-in-settings',
      detail: 'browser automation is disabled in settings (browser.enabled = false)',
      searched: [],
    };
  }
  return discoverBrowser(opts);
}
