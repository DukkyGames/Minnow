/**
 * Server-side Qwen3-TTS catalog metadata for downloads and installed manifest.
 */

/** @typedef {'custom_voice' | 'voice_design' | 'voice_clone' | 'tokenizer'} TtsCatalogMode */

export const QWEN_TOKENIZER_MODEL_ID = 'Qwen/Qwen3-TTS-Tokenizer-12Hz';

/** @type {Record<string, { mode: TtsCatalogMode, requiresTokenizer: boolean }>} */
const TTS_MODEL_META = {
  'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice': { mode: 'custom_voice', requiresTokenizer: true },
  'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice': { mode: 'custom_voice', requiresTokenizer: true },
  'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign': { mode: 'voice_design', requiresTokenizer: true },
  'Qwen/Qwen3-TTS-12Hz-0.6B-Base': { mode: 'voice_clone', requiresTokenizer: true },
  'Qwen/Qwen3-TTS-12Hz-1.7B-Base': { mode: 'voice_clone', requiresTokenizer: true },
  [QWEN_TOKENIZER_MODEL_ID]: { mode: 'tokenizer', requiresTokenizer: false },
};

/**
 * Resolve TTS catalog metadata for a HuggingFace model id.
 * @param {string} modelId
 */
export function resolveTtsCatalogMeta(modelId) {
  const known = TTS_MODEL_META[modelId];
  if (known) return known;

  const lower = modelId.toLowerCase();
  let mode = /** @type {TtsCatalogMode} */ ('custom_voice');
  if (lower.includes('voicedesign')) mode = 'voice_design';
  else if (lower.includes('base')) mode = 'voice_clone';
  else if (lower.includes('tokenizer')) mode = 'tokenizer';

  return {
    mode,
    requiresTokenizer: mode !== 'tokenizer',
  };
}
