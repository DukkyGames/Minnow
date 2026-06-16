/**
 * OAuth API client for Email / Calendar connect flows.
 */

export type OAuthProviderId = 'google' | 'microsoft';

export interface OAuthConnection {
  id: string;
  provider: OAuthProviderId;
  email: string;
  label: string;
  services: { email: boolean; calendar: boolean };
  hasTokens?: boolean;
  emailAccountId?: string;
  calendarAccountId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthStartResult {
  authUrl: string;
  state: string;
  redirectUri: string;
}

async function parseJson<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : res.statusText);
  }
  return payload;
}

export async function fetchOAuthConnections(): Promise<OAuthConnection[]> {
  const res = await fetch('/api/oauth/connections');
  const data = await parseJson<{ connections: OAuthConnection[] }>(res);
  return data.connections ?? [];
}

export async function startOAuthConnect(input: {
  provider: OAuthProviderId;
  services?: { email?: boolean; calendar?: boolean };
  label?: string;
}): Promise<OAuthStartResult> {
  const res = await fetch('/api/oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson<OAuthStartResult>(res);
}

export async function deleteOAuthConnection(connectionId: string): Promise<void> {
  const res = await fetch(`/api/oauth/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
  });
  await parseJson<{ deleted: boolean }>(res);
}

/**
 * Poll until a connection appears or timeout (after user completes browser OAuth).
 */
export async function waitForOAuthConnection(
  previousIds: Set<string>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<OAuthConnection | null> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connections = await fetchOAuthConnections();
    const fresh = connections.find((row) => !previousIds.has(row.id));
    if (fresh) {
      return fresh;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}
