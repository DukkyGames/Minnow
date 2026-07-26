/**
 * Client probe for MINNOW_SERVER_ENGINE (Phase 4 / MIN-362).
 * Prefer the HTML-injected flag; fall back to GET /api/session/engine.
 * Server default is ON; emergency opt-out is MINNOW_SERVER_ENGINE=0|false|off|no.
 */

import { withSessionToken } from '../api/session-token';

declare global {
  interface Window {
    __MINNOW_SERVER_ENGINE__?: boolean;
  }
}

let cached: boolean | null = null;
let probePromise: Promise<boolean> | null = null;

/** Synchronous read of the injected boot flag (undefined when not injected). */
export function readInjectedServerEngineFlag(): boolean | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.__MINNOW_SERVER_ENGINE__ === 'boolean') {
    return window.__MINNOW_SERVER_ENGINE__;
  }
  return null;
}

/**
 * True when main-chat / board / controller should use the Session Engine.
 * Until injection or probe resolves, returns false (safe for Vite-only / early boot).
 */
export function isServerEngineEnabled(): boolean {
  if (cached != null) return cached;
  const injected = readInjectedServerEngineFlag();
  if (injected != null) {
    cached = injected;
    return cached;
  }
  return false;
}

/** Resolve the flag (inject first; network probe as fallback). */
export async function ensureServerEngineFlag(): Promise<boolean> {
  if (cached != null) return cached;
  const injected = readInjectedServerEngineFlag();
  if (injected != null) {
    cached = injected;
    return cached;
  }
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const res = await fetch(withSessionToken('/api/session/engine'));
      if (!res.ok) {
        // Probe failed — keep Vite-only / offline clients on the legacy path.
        cached = false;
        return false;
      }
      const body = (await res.json()) as { enabled?: boolean };
      cached = body.enabled === true;
      return cached;
    } catch {
      cached = false;
      return false;
    } finally {
      probePromise = null;
    }
  })();
  return probePromise;
}

/** @internal */
export function setServerEngineFlagForTests(value: boolean | null): void {
  cached = value;
}
