/**
 * OAuth authorization flow: start, callback, token exchange, refresh.
 */

import { requireProviderCredentials } from './credentials.js';
import { consumePendingFlow, savePendingFlow } from './pending.js';
import { randomUrlSafeString } from './pkce.js';
import {
  buildAuthorizeUrl,
  scopesForServices,
  tokenEndpoint,
} from './providers.js';
import { getOAuthRedirectUri } from './redirect-base.js';
import {
  readConnectionTokens,
  upsertOAuthConnection,
  writeConnectionTokens,
} from './connections.js';
import { provisionOAuthConnection } from './provision.js';

/**
 * Start an OAuth connect flow.
 * @param {{ provider: 'google' | 'microsoft', services?: { email?: boolean, calendar?: boolean }, label?: string }} input
 */
export async function startOAuthFlow(input) {
  const provider = input.provider;
  if (provider !== 'google' && provider !== 'microsoft') {
    throw new Error('provider must be google or microsoft');
  }

  const credentials = await requireProviderCredentials(provider);
  const services = {
    email: input.services?.email !== false,
    calendar: input.services?.calendar !== false,
  };
  if (!services.email && !services.calendar) {
    throw new Error('At least one service (email or calendar) must be enabled');
  }

  const state = randomUrlSafeString(24);
  const codeVerifier = randomUrlSafeString(32);
  const { codeChallengeFromVerifier } = await import('./pkce.js');
  const challenge = codeChallengeFromVerifier(codeVerifier);

  const scopes = scopesForServices(provider, services);
  const authUrl = buildAuthorizeUrl(provider, credentials, {
    state,
    codeChallenge: challenge,
    scopes,
  });

  await savePendingFlow({
    state,
    provider,
    codeVerifier,
    services,
    label: String(input.label ?? '').trim(),
    createdAt: Date.now(),
  });

  return { authUrl, state, redirectUri: getOAuthRedirectUri() };
}

/**
 * Exchange authorization code for tokens.
 * @param {'google' | 'microsoft'} provider
 * @param {string} code
 * @param {string} codeVerifier
 * @param {string} scopes
 */
async function exchangeAuthorizationCode(provider, code, codeVerifier, scopes) {
  const credentials = await requireProviderCredentials(provider);
  const redirectUri = getOAuthRedirectUri();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code_verifier: codeVerifier,
  });

  const tenantId = provider === 'microsoft' ? credentials.tenantId ?? 'common' : 'common';
  const res = await fetch(tokenEndpoint(provider, tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = payload.error_description || payload.error || res.statusText;
    throw new Error(`Token exchange failed: ${detail}`);
  }

  const expiresIn = Number(payload.expires_in) || 3600;
  return {
    accessToken: String(payload.access_token ?? ''),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : undefined,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: String(payload.scope ?? scopes.join(' ')),
  };
}

/**
 * Fetch primary email from provider userinfo.
 * @param {'google' | 'microsoft'} provider
 * @param {string} accessToken
 */
async function fetchUserEmail(provider, accessToken) {
  if (provider === 'google') {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error?.message || 'Failed to load Google profile');
    }
    return String(data.email ?? '').trim();
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to load Microsoft profile');
  }
  return String(data.mail ?? data.userPrincipalName ?? '').trim();
}

/**
 * Handle OAuth callback query params.
 * @param {{ code?: string, state?: string, error?: string, error_description?: string }} query
 */
export async function handleOAuthCallback(query) {
  if (query.error) {
    throw new Error(query.error_description || query.error);
  }

  const code = String(query.code ?? '').trim();
  const state = String(query.state ?? '').trim();
  if (!code || !state) {
    throw new Error('Missing code or state');
  }

  const pending = await consumePendingFlow(state);
  if (!pending) {
    throw new Error('OAuth flow expired or invalid — start again from Email or Calendar');
  }

  const scopes = scopesForServices(pending.provider, pending.services);
  const tokens = await exchangeAuthorizationCode(
    pending.provider,
    code,
    pending.codeVerifier,
    scopes,
  );

  const email = await fetchUserEmail(pending.provider, tokens.accessToken);
  if (!email) {
    throw new Error('Could not determine account email from provider profile');
  }

  const connection = await upsertOAuthConnection({
    provider: pending.provider,
    email,
    label: pending.label || email,
    services: pending.services,
    tokens,
  });

  await provisionOAuthConnection(connection);

  return connection;
}

/**
 * Refresh access token when expired (or within 60s of expiry).
 * @param {string} connectionId
 */
export async function refreshConnectionTokensIfNeeded(connectionId) {
  const tokens = await readConnectionTokens(connectionId);
  if (tokens.expiresAt - Date.now() > 60_000) {
    return tokens;
  }
  if (!tokens.refreshToken) {
    throw new Error('OAuth session expired — reconnect your account in Email or Calendar');
  }

  const connection = await import('./connections.js').then((m) => m.getOAuthConnection(connectionId));
  if (!connection) {
    throw new Error('OAuth connection not found');
  }

  const credentials = await requireProviderCredentials(connection.provider);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  const tenantId =
    connection.provider === 'microsoft' ? credentials.tenantId ?? 'common' : 'common';
  const res = await fetch(tokenEndpoint(connection.provider, tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = payload.error_description || payload.error || res.statusText;
    throw new Error(`Token refresh failed: ${detail}`);
  }

  const expiresIn = Number(payload.expires_in) || 3600;
  const refreshed = {
    accessToken: String(payload.access_token ?? tokens.accessToken),
    refreshToken: payload.refresh_token
      ? String(payload.refresh_token)
      : tokens.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: String(payload.scope ?? tokens.scopes),
  };
  await writeConnectionTokens(connectionId, refreshed);
  return refreshed;
}

/** Return a valid access token, refreshing when needed. */
export async function getValidAccessToken(connectionId) {
  const tokens = await refreshConnectionTokensIfNeeded(connectionId);
  if (!tokens.accessToken) {
    throw new Error('OAuth access token is missing');
  }
  return tokens.accessToken;
}

/** Minimal HTML shown after successful OAuth callback. */
export function oauthCallbackSuccessHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Minnow — connected</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1f1c;color:#e8ede9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:28rem;padding:2rem;border:1px solid #3d4a42;border-radius:12px;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#a8b5ad}</style></head>
<body><div class="card"><h1>Account connected</h1><p>You can close this tab and return to Minnow.</p></div></body>
</html>`;
}

export function oauthCallbackErrorHtml(message) {
  const safe = String(message ?? 'Authorization failed')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Minnow — connection failed</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1f1c;color:#e8ede9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:28rem;padding:2rem;border:1px solid #5a3d3d;border-radius:12px;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem;color:#f0a8a8}p{margin:0;color:#a8b5ad}</style></head>
<body><div class="card"><h1>Connection failed</h1><p>${safe}</p></div></body>
</html>`;
}
