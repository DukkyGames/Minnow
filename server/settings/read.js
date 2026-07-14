/**
 * Resolve settings field values from server-backed storage (with redaction).
 */

import { readResource } from '../config/store.js';
import { getFieldByKey, loadRegistryManifest } from './registry.js';
import { formatReadValue } from './redact.js';
import { getAtPath } from './paths.js';

/**
 * @param {import('../../src/settings/types.ts').SettingsFieldDef} field
 */
async function readFieldValue(field) {
  if (field.storage === 'section' || field.storage === 'browser') {
    return {
      error: `Field "${field.key}" is ${field.storage}-only and cannot be read from the server. Open Settings or use the Minnow UI.`,
    };
  }

  if (!field.path) {
    return { error: `Field "${field.key}" has no storage path.` };
  }

  if (field.storage === 'meta') {
    const meta = await readResource('meta');
    const raw = getAtPath(meta, field.path);
    const formatted = formatReadValue(raw, field);
    return { value: formatted.value, configured: formatted.configured, redacted: formatted.redacted };
  }

  if (field.storage === 'resource') {
    const resource = field.resource;
    if (!resource) {
      return { error: `Field "${field.key}" missing resource name.` };
    }
    const doc = await readResource(resource);
    const raw = getAtPath(doc, field.path);
    const formatted = formatReadValue(raw, field);
    return { value: formatted.value, configured: formatted.configured, redacted: formatted.redacted };
  }

  return { error: `Storage kind "${field.storage}" is not yet supported for reads.` };
}

/**
 * @param {string[]} keys
 */
export async function readSettingsByKeys(keys) {
  /** @type {import('../../src/settings/types.ts').SettingsReadValue[]} */
  const values = [];
  /** @type {{ key: string; error: string }[]} */
  const errors = [];

  for (const key of keys) {
    const field = getFieldByKey(key);
    if (!field) {
      errors.push({ key, error: `Unknown settings key: ${key}` });
      continue;
    }
    const result = await readFieldValue(field);
    if (result.error) {
      errors.push({ key, error: result.error });
      continue;
    }
    values.push({
      key,
      label: field.label,
      value: result.value,
      configured: result.configured,
      redacted: result.redacted,
    });
  }

  return { values, errors };
}

/**
 * @param {{ category?: string; area?: string }} filter
 */
export async function readSettingsByFilter(filter) {
  let fields = loadRegistryManifest();
  if (filter.category) {
    fields = fields.filter((f) => f.category === filter.category);
  }
  if (filter.area) {
    fields = fields.filter((f) => f.area === filter.area);
  }
  const serverFields = fields.filter((f) => f.storage === 'meta' || f.storage === 'resource');
  return readSettingsByKeys(serverFields.map((f) => f.key));
}

/**
 * @param {{ keys?: string[]; category?: string; area?: string }} args
 */
export async function readSettings(args) {
  const keys = Array.isArray(args?.keys) ? args.keys.map(String).filter(Boolean) : [];
  const category = typeof args?.category === 'string' ? args.category.trim() : '';
  const area = typeof args?.area === 'string' ? args.area.trim() : '';

  if (keys.length > 0 && (category || area)) {
    return {
      values: [],
      errors: [{ key: '', error: 'Provide either keys or category/area filters, not both.' }],
    };
  }

  if (keys.length > 0) {
    return readSettingsByKeys(keys);
  }

  if (category || area) {
    return readSettingsByFilter({ category: category || undefined, area: area || undefined });
  }

  return {
    values: [],
    errors: [{ key: '', error: 'Provide keys and/or category/area filters.' }],
  };
}
