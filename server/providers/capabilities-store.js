/**
 * Read/write ~/.minnow/providers/<id>/capabilities.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { normalizeCapabilitiesFile, SCHEMA_VERSION } from './capabilities-schema.js';
import { validateProviderId } from './validate.js';

/**
 * @param {string} id
 * @returns {string}
 */
function capabilitiesPath(id) {
  validateProviderId(id);
  return path.join(getMinnowHome(), 'providers', id, 'capabilities.json');
}

/**
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function readCapabilities(id) {
  const file = capabilitiesPath(id);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return normalizeCapabilitiesFile(JSON.parse(raw));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return normalizeCapabilitiesFile(null);
    }
    console.warn(`[capabilities] corrupt file for ${id}, resetting:`, err);
    return normalizeCapabilitiesFile(null);
  }
}

/**
 * @param {string} id
 * @param {object} file
 */
export async function writeCapabilities(id, file) {
  validateProviderId(id);
  const normalized = normalizeCapabilitiesFile(file);
  const dir = path.dirname(capabilitiesPath(id));
  await fs.mkdir(dir, { recursive: true });
  const target = capabilitiesPath(id);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    providerId: id,
    probedAt: normalized.probedAt || new Date().toISOString(),
    apiKind: normalized.apiKind || 'openai-v1',
    models: normalized.models || {},
  };
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, target);
  return payload;
}

/**
 * Merge per-model entries into an existing capabilities file.
 *
 * @param {string} id
 * @param {Record<string, object>} modelPatches
 * @param {{ probedAt?: string, apiKind?: string }} meta
 */
export async function mergeCapabilities(id, modelPatches, meta = {}) {
  const existing = await readCapabilities(id);
  const models = { ...existing.models };
  for (const [modelId, patch] of Object.entries(modelPatches)) {
    models[modelId] = { ...(models[modelId] || {}), ...patch };
  }
  return writeCapabilities(id, {
    ...existing,
    providerId: id,
    probedAt: meta.probedAt || new Date().toISOString(),
    apiKind: meta.apiKind || existing.apiKind,
    models,
  });
}
