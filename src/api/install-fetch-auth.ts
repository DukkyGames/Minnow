/**
 * Global fetch interceptor: adds the session-token header to same-origin
 * /api/* requests, so the ~400 existing `fetch('/api/...')` call sites don't
 * need to be touched individually.
 *
 * On 401, refreshes the per-boot token from GET /api/auth/session-token and
 * retries once (covers dev-server restarts while the SPA tab stays open).
 */

import { getSessionToken, refreshSessionTokenFromServer } from './session-token.ts';

const TOKEN_HEADER = 'X-Minnow-Token';

let installed = false;

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
  if (raw.startsWith('/api/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(raw, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function isSessionTokenBootstrapRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
  return raw.includes('/api/auth/session-token');
}

function buildAuthedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
): { input: RequestInfo | URL; init?: RequestInit } {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set(TOKEN_HEADER, token);
  if (input instanceof Request) {
    return { input: new Request(input, { ...init, headers }) };
  }
  return { input, init: { ...init, headers } };
}

/** Install once at app bootstrap. */
export function installFetchAuth(): void {
  if (installed) return;
  installed = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);

  const fetchWithAuth = async (
    input: RequestInfo | URL,
    init?: RequestInit,
    allowRetry = true,
  ): Promise<Response> => {
    if (!isSameOriginApiRequest(input) || isSessionTokenBootstrapRequest(input)) {
      return nativeFetch(input, init);
    }

    let token = getSessionToken();
    if (!token && allowRetry) {
      await refreshSessionTokenFromServer(nativeFetch);
      token = getSessionToken();
    }
    if (!token) {
      return nativeFetch(input, init);
    }

    const authed = buildAuthedRequest(input, init, token);
    const response = await nativeFetch(authed.input, authed.init);

    if (response.status !== 401 || !allowRetry) {
      return response;
    }

    const refreshed = await refreshSessionTokenFromServer(nativeFetch);
    if (!refreshed) {
      return response;
    }

    const retryToken = getSessionToken();
    if (!retryToken || retryToken === token) {
      return response;
    }

    // Request bodies are one-shot — rebuildAuthed from a Request after the first
    // send can throw. Only retry string/URL inputs (the common /api/* path).
    if (typeof input !== 'string' && !(input instanceof URL)) {
      return response;
    }

    const retry = buildAuthedRequest(input, init, retryToken);
    return nativeFetch(retry.input, retry.init);
  };

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithAuth(input, init)) as typeof fetch;
}
