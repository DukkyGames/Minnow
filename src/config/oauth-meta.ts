/**
 * OAuth BYO credentials in config.json (client-side load/save).
 */

export interface OAuthGoogleCredentials {
  clientId: string;
  hasClientSecret: boolean;
}

export interface OAuthMicrosoftCredentials {
  clientId: string;
  tenantId: string;
  hasClientSecret: boolean;
}

export interface OAuthConfigView {
  google: OAuthGoogleCredentials;
  microsoft: OAuthMicrosoftCredentials;
  redirectUri?: string;
}

export interface OAuthConfigSave {
  google?: { clientId?: string; clientSecret?: string };
  microsoft?: { clientId?: string; clientSecret?: string; tenantId?: string };
}

/** Load OAuth settings from config API + redirect URI from OAuth ping. */
export async function loadOAuthSettings(): Promise<OAuthConfigView> {
  const [metaRes, pingRes] = await Promise.all([
    fetch('/api/config/meta', { cache: 'no-store' }),
    fetch('/api/oauth/ping', { cache: 'no-store' }).catch(() => null),
  ]);

  let google: OAuthGoogleCredentials = { clientId: '', hasClientSecret: false };
  let microsoft: OAuthMicrosoftCredentials = {
    clientId: '',
    tenantId: 'common',
    hasClientSecret: false,
  };

  if (metaRes.ok) {
    const meta = (await metaRes.json()) as { oauth?: Record<string, unknown> };
    const oauth = meta.oauth ?? {};
    const g = oauth.google as Record<string, unknown> | undefined;
    const m = oauth.microsoft as Record<string, unknown> | undefined;
    google = {
      clientId: String(g?.clientId ?? '').trim(),
      hasClientSecret: Boolean(String(g?.clientSecret ?? '').trim()),
    };
    microsoft = {
      clientId: String(m?.clientId ?? '').trim(),
      tenantId: String(m?.tenantId ?? 'common').trim() || 'common',
      hasClientSecret: Boolean(String(m?.clientSecret ?? '').trim()),
    };
  }

  let redirectUri: string | undefined;
  if (pingRes?.ok) {
    const ping = (await pingRes.json()) as { redirectUri?: string };
    redirectUri = ping.redirectUri;
  }

  return { google, microsoft, redirectUri };
}

/** Persist partial OAuth credentials via PUT /api/config/meta. */
export async function saveOAuthSettings(patch: OAuthConfigSave): Promise<void> {
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oauth: patch }),
  });
}
