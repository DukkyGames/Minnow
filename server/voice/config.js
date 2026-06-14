/**
 * Load and normalize voice settings from ~/.minnow/config.json.
 */

import { readConfigJson } from '../config/store.js';
import { normalizeVoiceConfig } from '../config/validators.js';

/** @typedef {import('../config/validators.js').VoiceConfig} VoiceConfig */

/**
 * Read voice config with defaults applied.
 * @returns {Promise<VoiceConfig>}
 */
export async function loadVoiceConfig() {
  const meta = (await readConfigJson('config.json')) ?? {};
  const existing =
    meta.voice && typeof meta.voice === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.voice)
      : {};
  return normalizeVoiceConfig(existing, existing);
}

/**
 * Resolve OpenAI-compatible audio API paths for a provider profile.
 * @param {{ transcriptionsPath?: string, speechPath?: string }} paths
 */
export function resolveVoicePaths(paths = {}) {
  return {
    transcriptionsPath: paths.transcriptionsPath || '/v1/audio/transcriptions',
    speechPath: paths.speechPath || '/v1/audio/speech',
  };
}
