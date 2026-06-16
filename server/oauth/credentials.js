/**
 * Read BYO OAuth client credentials from config.json.
 */

import { readConfigJson } from '../config/store.js';

/**
 * @typedef {object} GoogleOAuthCredentials
 * @property {string} clientId
 * @property {string} clientSecret
 */

/**
 * @typedef {object} MicrosoftOAuthCredentials
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} tenantId
 */

/**
 * @returns {Promise<{ google?: GoogleOAuthCredentials, microsoft?: MicrosoftOAuthCredentials }>}
 */
export async function loadOAuthCredentials() {
  const meta = (await readConfigJson('config.json')) ?? {};
  const oauth = meta.oauth && typeof meta.oauth === 'object' ? meta.oauth : {};
  const out = {};

  const google = oauth.google && typeof oauth.google === 'object' ? oauth.google : null;
  if (google) {
    const clientId = String(google.clientId ?? '').trim();
    const clientSecret = String(google.clientSecret ?? '').trim();
    if (clientId && clientSecret) {
      out.google = { clientId, clientSecret };
    }
  }

  const microsoft = oauth.microsoft && typeof oauth.microsoft === 'object' ? oauth.microsoft : null;
  if (microsoft) {
    const clientId = String(microsoft.clientId ?? '').trim();
    const clientSecret = String(microsoft.clientSecret ?? '').trim();
    const tenantId = String(microsoft.tenantId ?? 'common').trim() || 'common';
    if (clientId && clientSecret) {
      out.microsoft = { clientId, clientSecret, tenantId };
    }
  }

  return out;
}

/**
 * Resolve credentials for a provider or throw a helpful error.
 * @param {'google' | 'microsoft'} provider
 */
export async function requireProviderCredentials(provider) {
  const loaded = await loadOAuthCredentials();
  const creds = loaded[provider];
  if (!creds) {
    const label = provider === 'google' ? 'Google' : 'Microsoft';
    throw new Error(
      `${label} OAuth is not configured — add Client ID and Secret in Settings → Integrations → OAuth`,
    );
  }
  return creds;
}

/**
 * Redacted credentials for Settings API (secrets masked).
 */
export async function loadOAuthCredentialsForApi() {
  const meta = (await readConfigJson('config.json')) ?? {};
  const oauth = meta.oauth && typeof meta.oauth === 'object' ? meta.oauth : {};
  const google = oauth.google && typeof oauth.google === 'object' ? oauth.google : {};
  const microsoft = oauth.microsoft && typeof oauth.microsoft === 'object' ? oauth.microsoft : {};

  return {
    google: {
      clientId: String(google.clientId ?? '').trim(),
      hasClientSecret: Boolean(String(google.clientSecret ?? '').trim()),
    },
    microsoft: {
      clientId: String(microsoft.clientId ?? '').trim(),
      tenantId: String(microsoft.tenantId ?? 'common').trim() || 'common',
      hasClientSecret: Boolean(String(microsoft.clientSecret ?? '').trim()),
    },
  };
}
