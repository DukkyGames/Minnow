#!/usr/bin/env node
/**
 * Wait until the Minnow dev server (Vite + /api middleware) is reachable.
 * Prefers ~/.minnow/run/dev-host.json written by server.js, then probes /api/config/ping.
 */

import { readDevHostState } from '../server/runtime/dev-host-state.js';
import { resolveMinnowPort } from '../server/constants/minnow-port.js';

/**
 * @param {string} origin e.g. http://localhost:9473
 * @returns {Promise<boolean>}
 */
async function pingMinnowApi(origin) {
  const base = origin.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/config/ping`, { method: 'GET' });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

/**
 * @param {number} port
 * @returns {Promise<string | null>}
 */
async function tryPort(port) {
  for (const host of ['localhost', '127.0.0.1']) {
    const origin = `http://${host}:${port}`;
    if (await pingMinnowApi(origin)) return origin;
  }
  return null;
}

/**
 * @param {{ timeoutMs?: number, intervalMs?: number, preferredPort?: number }} [options]
 * @returns {Promise<{ origin: string, port: number }>}
 */
export async function waitForMinnowDev(options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const preferred = options.preferredPort ?? resolveMinnowPort();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = readDevHostState();
    if (state?.localUrl && (await pingMinnowApi(state.localUrl))) {
      return { origin: state.localUrl, port: state.port };
    }

    const direct = await tryPort(preferred);
    if (direct) {
      const port = Number(new URL(`${direct}/`).port) || preferred;
      return { origin: direct, port };
    }

    // Vite may have auto-incremented by one when strictPort is false.
    const bumped = await tryPort(preferred + 1);
    if (bumped) {
      const port = Number(new URL(`${bumped}/`).port) || preferred + 1;
      return { origin: bumped, port };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out waiting for Minnow dev server (expected near port ${preferred}; check server logs)`,
  );
}
