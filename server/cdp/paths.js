/**
 * Screenshot paths under ~/.speedchat/screenshots/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getSpeedChatHome } from '../config/home.js';
import { loadBrowserConfig } from './browser-config.js';

/**
 * Directory for saved PNG screenshots.
 * @returns {Promise<string>}
 */
export async function getScreenshotsDir() {
  const cfg = await loadBrowserConfig();
  const dir = path.join(getSpeedChatHome(), cfg.screenshotDir || 'screenshots');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve screenshot file by id (basename only — no traversal).
 * @param {string} id
 * @returns {Promise<string | null>}
 */
export async function resolveScreenshotPath(id) {
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return null;
  }
  const dir = await getScreenshotsDir();
  const resolved = path.resolve(dir, `${id}.png`);
  const dirResolved = path.resolve(dir);
  if (!resolved.startsWith(dirResolved + path.sep) && resolved !== dirResolved) {
    return null;
  }
  try {
    await fs.access(resolved);
    return resolved;
  } catch {
    return null;
  }
}

/**
 * @param {Buffer} pngBuffer
 * @param {string} [id] Optional fixed id (tests)
 * @returns {Promise<{ id: string; filePath: string; sizeBytes: number }>}
 */
export async function writeScreenshot(pngBuffer, id) {
  const screenshotId =
    id ??
    `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
  const dir = await getScreenshotsDir();
  const filePath = path.join(dir, `${screenshotId}.png`);
  await fs.writeFile(filePath, pngBuffer);
  const stat = await fs.stat(filePath);
  return { id: screenshotId, filePath, sizeBytes: stat.size };
}
