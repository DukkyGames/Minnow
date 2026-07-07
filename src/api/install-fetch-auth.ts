/**
 * Global fetch interceptor: adds the session-token header to same-origin
 * /api/* requests, so the ~400 existing `fetch('/api/...')` call sites don't
 * need to be touched individually.
 */

import { getSessionToken } from './session-token.ts';

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

/** Install once at app bootstrap. */
export function installFetchAuth(): void {
  if (installed) return;
  installed = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const token = getSessionToken();
    if (!token || !isSameOriginApiRequest(input)) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(TOKEN_HEADER, token);

    if (input instanceof Request) {
      return nativeFetch(new Request(input, { ...init, headers }));
    }
    return nativeFetch(input, { ...init, headers });
  }) as typeof fetch;
}
