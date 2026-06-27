/**
 * Injectable base URL for headless CLI — rewrites relative /api/* fetch calls.
 */

import { defaultMinnowLocalOrigin } from '../config/minnow-port.ts';

let headlessBaseUrl = defaultMinnowLocalOrigin();
let restoreFetch: (() => void) | null = null;

/** Normalize base URL (no trailing slash). */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/** Current headless API origin. */
export function getHeadlessBaseUrl(): string {
  return headlessBaseUrl;
}

/** Resolve an API path against the headless base URL. */
export function headlessApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${headlessBaseUrl}${p}`;
}

/** Patch global fetch so `/api/...` hits the dev server (returns restore fn). */
export function installHeadlessFetch(baseUrl: string): () => void {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
  headlessBaseUrl = normalizeBaseUrl(baseUrl);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(headlessApiUrl(input), init);
    }
    if (input instanceof Request) {
      const url = input.url;
      if (url.startsWith('/api/')) {
        return nativeFetch(headlessApiUrl(url), init);
      }
    }
    return nativeFetch(input, init);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = nativeFetch;
    restoreFetch = null;
  };
  return restoreFetch;
}

/** Minimal localStorage for Node (config loaders mirror to localStorage). */
export function installHeadlessLocalStorage(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}
