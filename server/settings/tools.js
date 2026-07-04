/**
 * Agent-facing settings tools — search, read, and update Minnow Settings.
 */

import { loadRegistryManifest, searchFieldRegistry } from './registry.js';
import { readSettings } from './read.js';
import {
  buildSettingsApprovalDiff,
  parseUpdateSettingsArgs,
  updateSettings,
} from './update.js';

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolSearchSettings(args) {
  const query = String(args?.query ?? '').trim();
  const category = typeof args?.category === 'string' ? args.category.trim() : undefined;
  const area = typeof args?.area === 'string' ? args.area.trim() : undefined;

  const results = searchFieldRegistry(query, { category, area });
  if (!results.length) {
    return query
      ? `No settings fields match "${query}".`
      : 'No settings fields found for the given filters.';
  }

  return JSON.stringify(results, null, 2);
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolGetSettings(args) {
  const keys = Array.isArray(args?.keys) ? args.keys : undefined;
  const category = typeof args?.category === 'string' ? args.category : undefined;
  const area = typeof args?.area === 'string' ? args.area : undefined;

  const { values, errors } = await readSettings({ keys, category, area });

  const payload = { values };
  if (errors.length) {
    payload.errors = errors;
  }

  if (!values.length && errors.length) {
    return `Error: ${errors.map((e) => e.error).join('; ')}`;
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolUpdateSettings(args) {
  const { changes, confirmed } = parseUpdateSettingsArgs(args);

  if (!changes.length) {
    return 'Error: changes array is required and must contain at least one { key, value } entry.';
  }

  const result = await updateSettings(changes, confirmed);

  if (!result.applied.length && result.errors.length) {
    return `Error: ${result.errors.map((e) => `${e.key}: ${e.error}`).join('; ')}`;
  }

  return JSON.stringify(result, null, 2);
}

/** Full registry metadata for GET /api/settings/catalog. */
export function getSettingsCatalog() {
  return loadRegistryManifest().map((field) => ({
    key: field.key,
    label: field.label,
    description: field.description,
    type: field.type,
    category: field.category,
    area: field.area,
    allowedValues: field.allowedValues,
    sensitivity: field.sensitivity,
    writable: field.writable,
    storage: field.storage,
  }));
}

export { buildSettingsApprovalDiff };
