/**
 * OpenCode Zen path normalization for provider upstream URLs.
 *
 * Minnow speaks OpenAI chat/completions; Zen's gateway converts GPT models to the
 * Responses API internally. Keep the configured chat completions path — do not
 * reroute to /responses (that breaks when base URL is https://opencode.ai).
 * See https://opencode.ai/docs/zen/
 */

import { isOpenCodeProviderBaseUrl } from './models-dev-context.js';

/**
 * Avoid https://opencode.ai/zen/v1/v1/chat/completions when defaults stack /v1 twice.
 * @param {string} baseUrl
 * @param {string} relativePath
 */
export function normalizeOpenCodeZenRelativePath(baseUrl, relativePath) {
  const base = typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '') : '';
  const path = typeof relativePath === 'string' ? relativePath : '';
  if (!base || !path) return path;
  if (isOpenCodeProviderBaseUrl(base) && base.endsWith('/v1') && path.startsWith('/v1/')) {
    return path.slice(3);
  }
  return path;
}

/**
 * Resolve upstream chat/completions URL (normalized for OpenCode Zen path quirks).
 * @param {string} baseUrl
 * @param {string} chatCompletionsPath
 */
export function resolveOpenCodeZenUpstreamUrl(baseUrl, chatCompletionsPath) {
  const base = baseUrl.replace(/\/$/, '');
  const chatPath = normalizeOpenCodeZenRelativePath(base, chatCompletionsPath);
  return `${base}${chatPath}`;
}
