/**
 * Server-side Education Mode flag from ~/.minnow/config.json (`education` block).
 * Mirrors src/config/education-meta.ts; mtime-cached like cdp/browser-config.js.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from './home.js';

/** @typedef {'beginner' | 'intermediate' | 'advanced'} EducationLevel */
/** @typedef {{ enabled: boolean, level: EducationLevel }} EducationConfig */

const EDUCATION_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

/** @type {EducationConfig} */
export const DEFAULT_EDUCATION_CONFIG = {
  enabled: false,
  level: 'beginner',
};

let cachedConfig = null;
let cachedMtime = 0;

/**
 * @param {unknown} raw
 * @returns {EducationConfig}
 */
export function mergeEducationConfig(raw) {
  const base = { ...DEFAULT_EDUCATION_CONFIG };
  if (!raw || typeof raw !== 'object') return base;
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (typeof row.enabled === 'boolean') base.enabled = row.enabled;
  if (typeof row.level === 'string') {
    const level = row.level.trim().toLowerCase();
    if (EDUCATION_LEVELS.has(level)) {
      base.level = /** @type {EducationLevel} */ (level);
    }
  }
  return base;
}

/**
 * Read the education section from config.json (cached by mtime).
 * @returns {Promise<EducationConfig>}
 */
export async function loadEducationConfig() {
  const configPath = path.join(getMinnowHome(), 'config.json');
  try {
    const stat = await fs.stat(configPath);
    if (cachedConfig && stat.mtimeMs === cachedMtime) {
      return cachedConfig;
    }
    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    cachedConfig = mergeEducationConfig(raw?.education);
    cachedMtime = stat.mtimeMs;
    return cachedConfig;
  } catch {
    cachedConfig = mergeEducationConfig(null);
    cachedMtime = 0;
    return cachedConfig;
  }
}

/** @returns {Promise<boolean>} */
export async function isEducationModeEnabled() {
  return (await loadEducationConfig()).enabled;
}

/** Reset cache (tests + writeResource('meta') invalidation). */
export function resetEducationCache() {
  cachedConfig = null;
  cachedMtime = 0;
}
