/**
 * Build an @ai-sdk/anthropic provider from Minnow provider runtime metadata.
 */

import { createAnthropic } from '@ai-sdk/anthropic';

/**
 * Derive the Anthropic SDK baseURL from provider origin + messages path directory.
 * E.g. `https://opencode.ai` + `/zen/v1/messages` → `https://opencode.ai/zen/v1`.
 *
 * @param {string} baseUrl
 * @param {string} messagesPath
 * @returns {string}
 */
export function deriveAnthropicBaseUrl(baseUrl, messagesPath) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const path = String(messagesPath || '/v1/messages');
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const lastSlash = withSlash.lastIndexOf('/');
  const dir = lastSlash <= 0 ? '' : withSlash.slice(0, lastSlash);
  return `${normalizedBase}${dir}`;
}

/**
 * Resolve apiKey vs authToken for createAnthropic from profile authStyle.
 * @param {object} profile
 * @param {object} secrets
 * @returns {{ apiKey?: string, authToken?: string }}
 */
function buildAuthOptions(profile, secrets) {
  const apiKey = typeof secrets?.apiKey === 'string' ? secrets.apiKey.trim() : '';
  const bearerToken =
    typeof secrets?.bearerToken === 'string' ? secrets.bearerToken.trim() : '';
  const authStyle = profile?.authStyle || 'bearer';

  if ((authStyle === 'x-api-key' || authStyle === 'api-key') && apiKey) {
    return { apiKey };
  }

  const token = bearerToken || apiKey;
  if (token) {
    return { authToken: token };
  }

  return {};
}

/**
 * Non-auth headers merged into the Anthropic SDK client (custom + overrides).
 * @param {object} profile
 * @param {object} secrets
 * @returns {Record<string, string>}
 */
function buildCustomHeaders(profile, secrets) {
  /** @type {Record<string, string>} */
  const headers = {};

  if (profile?.customHeaders && typeof profile.customHeaders === 'object') {
    for (const [key, value] of Object.entries(profile.customHeaders)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  if (secrets?.headerOverrides && typeof secrets.headerOverrides === 'object') {
    for (const [key, value] of Object.entries(secrets.headerOverrides)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  return headers;
}

/**
 * @param {{ profile: object, paths: object, secrets: object }} runtime
 * @returns {import('@ai-sdk/anthropic').AnthropicProvider}
 */
export function buildAnthropicProvider(runtime) {
  const { profile, paths, secrets } = runtime;
  const messagesPath = paths?.chatCompletionsPath || '/v1/messages';
  const baseURL = deriveAnthropicBaseUrl(profile.baseUrl, messagesPath);
  const auth = buildAuthOptions(profile, secrets);
  const headers = buildCustomHeaders(profile, secrets);

  return createAnthropic({
    baseURL,
    ...auth,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });
}
