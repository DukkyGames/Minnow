/**
 * OAuth provider endpoints, scopes, and authorize URL builders.
 */

import { getOAuthRedirectUri } from './redirect-base.js';

/** @typedef {'google' | 'microsoft'} OAuthProviderId */

export const GOOGLE_EMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const MICROSOFT_MAIL_SCOPES = ['Mail.ReadWrite', 'Mail.Send', 'offline_access'];
export const MICROSOFT_CALENDAR_SCOPES = ['Calendars.ReadWrite', 'offline_access'];

/**
 * Resolve scope list for a provider and requested services.
 * @param {OAuthProviderId} provider
 * @param {{ email?: boolean, calendar?: boolean }} services
 */
export function scopesForServices(provider, services) {
  const wantEmail = services.email !== false;
  const wantCalendar = services.calendar !== false;

  if (provider === 'google') {
    const scopes = ['openid', 'email', 'profile'];
    if (wantEmail) scopes.push(GOOGLE_EMAIL_SCOPE);
    if (wantCalendar) scopes.push(GOOGLE_CALENDAR_SCOPE);
    return [...new Set(scopes)];
  }

  const scopes = ['openid', 'email', 'profile', 'offline_access', 'User.Read'];
  if (wantEmail) {
    scopes.push('Mail.ReadWrite', 'Mail.Send');
  }
  if (wantCalendar) {
    scopes.push('Calendars.ReadWrite');
  }
  return [...new Set(scopes)];
}

/**
 * Build the provider authorization URL.
 * @param {OAuthProviderId} provider
 * @param {{ clientId: string, tenantId?: string }} credentials
 * @param {{ state: string, codeChallenge: string, scopes: string[] }} flow
 */
export function buildAuthorizeUrl(provider, credentials, flow) {
  const redirectUri = getOAuthRedirectUri();

  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: flow.scopes.join(' '),
      state: flow.state,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: flow.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const tenant = String(credentials.tenantId ?? 'common').trim() || 'common';
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: flow.scopes.join(' '),
    state: flow.state,
    code_challenge: flow.codeChallenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Token endpoint URL for a provider.
 * @param {OAuthProviderId} provider
 * @param {string} [tenantId]
 */
export function tokenEndpoint(provider, tenantId = 'common') {
  if (provider === 'google') {
    return 'https://oauth2.googleapis.com/token';
  }
  const tenant = String(tenantId ?? 'common').trim() || 'common';
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}
