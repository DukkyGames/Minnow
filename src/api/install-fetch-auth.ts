import { getDeviceToken, getSessionToken, hasHostSessionToken } from './session-token.ts';

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

    const request =
      input instanceof Request
        ? nativeFetch(new Request(input, { ...init, headers }))
        : nativeFetch(input, { ...init, headers });
    return request.then((response) => {
      if (
        response.status === 401 &&
        !hasHostSessionToken() &&
        Boolean(getDeviceToken()) &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new Event('minnow-auth-revoked'));
      }
      return response;
    });
  }) as typeof fetch;
}
