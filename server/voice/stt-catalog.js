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
 * Whether a HuggingFace model id is a known Whisper STT model.
 * @param {string} modelId
 */
export function isSttCatalogModel(modelId) {
  if (STT_MODEL_IDS.has(modelId)) return true;
  const lower = modelId.toLowerCase();
  return lower.includes('whisper') || lower.includes('/asr') || lower.endsWith('-stt');
}
