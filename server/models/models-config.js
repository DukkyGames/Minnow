/**
 * Models app config slice from config.json → models.*
 */

import { readConfigJson } from '../config/store.js';

/**
 * Read models settings (HF token, custom model dirs) from config.json.
 * @returns {Promise<{ hfToken?: string, modelDirs?: string[] }>}
 */
export async function getModelsConfig() {
  const config = (await readConfigJson('config.json')) ?? {};
  const models =
    config.models && typeof config.models === 'object'
      ? /** @type {Record<string, unknown>} */ (config.models)
      : {};
  return models;
}

/**
 * Persist models settings into config.json (merge into existing models object).
 * @param {Record<string, unknown>} patch
 */
export async function patchModelsConfig(patch) {
  const { readConfigJson, writeConfigJson } = await import('../config/store.js');
  const config = (await readConfigJson('config.json')) ?? {};
  const prev =
    config.models && typeof config.models === 'object'
      ? /** @type {Record<string, unknown>} */ (config.models)
      : {};
  config.models = { ...prev, ...patch };
  await writeConfigJson('config.json', config);
  return config.models;
}
