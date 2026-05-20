/**
 * Tool path security flags from persisted config.json (`toolSecurity` block).
 */

import { readConfigJson } from './store.js';

/**
 * @returns {Promise<'workspace'|'full'>}
 */
export async function getFilesystemAccessFromConfig() {
  try {
    const meta = await readConfigJson('config.json');
    if (meta && typeof meta === 'object') {
      const ts = /** @type {Record<string, unknown>} */ (meta).toolSecurity;
      if (ts && typeof ts === 'object') {
        const fa = /** @type {Record<string, unknown>} */ (ts).filesystemAccess;
        if (fa === 'full') return 'full';
      }
    }
  } catch {
    /* ignore */
  }
  return 'workspace';
}
