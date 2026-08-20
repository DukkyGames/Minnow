/**
 * Per-library-model inference prefs (sampler overrides) in config.json → models.inference.
 */

import { normalizeSamplerPreset } from '../agents/sampler.js';
import { getModelsConfig, patchModelsConfig } from './models-config.js';

/**
 * @typedef {object} ModelsInferenceBlock
 * @property {Record<string, Record<string, unknown>>} byLibraryId
 * @property {Record<string, string>} chatModelAliases model id / label → library id
 */

/**
 * @param {unknown} raw
 * @returns {ModelsInferenceBlock}
 */
export function normalizeInferenceBlock(raw) {
  const block =
    raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const byLibraryId =
    block.byLibraryId && typeof block.byLibraryId === 'object'
      ? /** @type {Record<string, Record<string, number>>} */ ({ ...block.byLibraryId })
      : {};
  const chatModelAliases =
    block.chatModelAliases && typeof block.chatModelAliases === 'object'
      ? /** @type {Record<string, string>} */ ({ ...block.chatModelAliases })
      : {};

  const cleanedById = {};
  for (const [libraryId, preset] of Object.entries(byLibraryId)) {
    if (typeof libraryId !== 'string' || !libraryId.trim()) continue;
    const normalized = normalizeSamplerPreset(preset);
    if (normalized && Object.keys(normalized).length > 0) {
      cleanedById[libraryId] = normalized;
    }
  }

  const cleanedAliases = {};
  for (const [label, libraryId] of Object.entries(chatModelAliases)) {
    if (typeof label !== 'string' || !label.trim()) continue;
    if (typeof libraryId !== 'string' || !libraryId.trim()) continue;
    if (!cleanedById[libraryId]) continue;
    cleanedAliases[label.trim()] = libraryId;
  }

  return { byLibraryId: cleanedById, chatModelAliases: cleanedAliases };
}

/**
 * @returns {Promise<ModelsInferenceBlock>}
 */
export async function getInferencePrefs() {
  const models = await getModelsConfig();
  return normalizeInferenceBlock(models.inference);
}

/**
 * @param {string} libraryId
 * @param {Record<string, number> | null} sampler
 * @param {string[]} [aliases] chat model ids / labels that should resolve to this library row
 * @returns {Promise<ModelsInferenceBlock>}
 */
export async function setLibraryInferenceSampler(libraryId, sampler, aliases = []) {
  const id = typeof libraryId === 'string' ? libraryId.trim() : '';
  if (!id) {
    throw new Error('libraryId is required');
  }

  const models = await getModelsConfig();
  const inference = normalizeInferenceBlock(models.inference);

  const normalized = sampler === null ? null : normalizeSamplerPreset(sampler);
  const hasPreset = normalized && Object.keys(normalized).length > 0;

  if (!hasPreset) {
    delete inference.byLibraryId[id];
    for (const [label, targetId] of Object.entries(inference.chatModelAliases)) {
      if (targetId === id) delete inference.chatModelAliases[label];
    }
  } else {
    inference.byLibraryId[id] = normalized;
    for (const alias of aliases) {
      if (typeof alias !== 'string') continue;
      const label = alias.trim();
      if (!label) continue;
      inference.chatModelAliases[label] = id;
    }
  }

  await patchModelsConfig({ inference });
  return inference;
}
