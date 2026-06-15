/**
 * Server-side Whisper STT catalog metadata for installed manifest rebuild.
 */

/** @type {Set<string>} */
const STT_MODEL_IDS = new Set([
  'openai/whisper-tiny',
  'openai/whisper-base',
  'openai/whisper-small',
  'openai/whisper-medium',
  'openai/whisper-large-v3',
]);

/**
 * Catalog ids map to Systran CTranslate2 repos for faster-whisper (not openai/whisper-* HF weights).
 * @type {Record<string, string>}
 */
const STT_DOWNLOAD_REPO_BY_CATALOG_ID = {
  'openai/whisper-tiny': 'Systran/faster-whisper-tiny',
  'openai/whisper-base': 'Systran/faster-whisper-base',
  'openai/whisper-small': 'Systran/faster-whisper-small',
  'openai/whisper-medium': 'Systran/faster-whisper-medium',
  'openai/whisper-large-v3': 'Systran/faster-whisper-large-v3',
};

/**
 * Whether a HuggingFace model id is a known Whisper STT model.
 * @param {string} modelId
 */
export function isSttCatalogModel(modelId) {
  if (STT_MODEL_IDS.has(modelId)) return true;
  const lower = modelId.toLowerCase();
  return lower.includes('whisper') || lower.includes('/asr') || lower.endsWith('-stt');
}

/**
 * Resolve the HF repo to download for a catalog STT model id.
 * @param {string} modelId
 */
export function resolveSttDownloadRepoId(modelId) {
  return STT_DOWNLOAD_REPO_BY_CATALOG_ID[modelId] ?? modelId;
}
