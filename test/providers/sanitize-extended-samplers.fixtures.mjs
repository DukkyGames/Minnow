/**
 * Shared keep-vs-strip cases for client and server sanitizeCompletionBodyForProvider.
 * Hardcoded providers — no random ids. Both test files must agree on these rows.
 */

export const EXTENDED_SAMPLER_BODY = {
  model: 'qwen3',
  temperature: 0.7,
  top_k: 20,
  min_p: 0.05,
  repetition_penalty: 1.1,
  enable_thinking: false,
};

/**
 * @typedef {{
 *   name: string,
 *   provider: { id: string, apiKind: string, supportsExtendedSamplers?: boolean },
 *   keep: string[],
 *   strip: string[],
 * }} ExtendedSamplerCase
 */

/** @type {ExtendedSamplerCase[]} */
export const EXTENDED_SAMPLER_CASES = [
  {
    name: 'hosted openai-v1 strips extended samplers',
    provider: { id: 'openai-v1', apiKind: 'openai-v1' },
    keep: ['temperature'],
    strip: ['top_k', 'min_p', 'repetition_penalty', 'enable_thinking'],
  },
  {
    name: 'llama-cpp-local id fallback keeps extended samplers',
    provider: { id: 'llama-cpp-local', apiKind: 'openai-v1' },
    keep: ['temperature', 'top_k', 'min_p', 'repetition_penalty', 'enable_thinking'],
    strip: [],
  },
  {
    name: 'mlx-lm-local id fallback keeps extended samplers',
    provider: { id: 'mlx-lm-local', apiKind: 'openai-v1' },
    keep: ['temperature', 'top_k', 'min_p', 'repetition_penalty', 'enable_thinking'],
    strip: [],
  },
  {
    name: 'supportsExtendedSamplers flag keeps even on other ids',
    provider: { id: 'custom-local', apiKind: 'openai-v1', supportsExtendedSamplers: true },
    keep: ['temperature', 'top_k', 'min_p', 'repetition_penalty', 'enable_thinking'],
    strip: [],
  },
  {
    name: 'flag false on openai-v1 still strips',
    provider: { id: 'openai-v1', apiKind: 'openai-v1', supportsExtendedSamplers: false },
    keep: ['temperature'],
    strip: ['top_k', 'min_p', 'repetition_penalty', 'enable_thinking'],
  },
];
