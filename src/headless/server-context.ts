/**
 * Injectable base URL for headless CLI — rewrites relative /api/* fetch calls.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultMinnowLocalOrigin } from '../config/minnow-port.ts';

let headlessBaseUrl = defaultMinnowLocalOrigin();
let restoreFetch: (() => void) | null = null;

/** Resolve ~/.minnow (or MINNOW_HOME override) without importing server/* from src/. */
function resolveMinnowHome(): string {
  const override = process.env.MINNOW_HOME?.trim() || process.env.SPEEDCHAT_HOME?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.minnow');
}

/** Read the session token a running server wrote to disk at boot. Empty string if absent. */
export function readSessionTokenFile(): string {
  try {
    return fs.readFileSync(path.join(resolveMinnowHome(), 'session-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

/** --token flag > MINNOW_TOKEN env > the token file a running server wrote at boot. */
export function resolveHeadlessToken(explicitToken?: string | null): string {
  return explicitToken?.trim() || process.env.MINNOW_TOKEN?.trim() || readSessionTokenFile();
}

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

function withTokenHeader(init: RequestInit | undefined, token: string): RequestInit | undefined {
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set('X-Minnow-Token', token);
  return { ...init, headers };
}

/** Patch global fetch so `/api/...` hits the dev server (returns restore fn). */
export function installHeadlessFetch(baseUrl: string, token = ''): () => void {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
  headlessBaseUrl = normalizeBaseUrl(baseUrl);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(headlessApiUrl(input), withTokenHeader(init, token));
    }
    if (input instanceof Request) {
      const url = input.url;
      if (url.startsWith('/api/')) {
        return nativeFetch(headlessApiUrl(url), withTokenHeader(init, token));
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
