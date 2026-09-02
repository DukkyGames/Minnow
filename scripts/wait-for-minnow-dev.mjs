#!/usr/bin/env node

import {
  isDevHostProcessAlive,
  readDevHostState,
} from '../server/runtime/dev-host-state.js';
import { readSessionTokenFile } from '../server/runtime/session-token.js';
import { resolveMinnowPort } from '../server/constants/minnow-port.js';

/**
 * @param {{ token?: string | null }} [options]
 * @returns {string}
 */
function resolvePingToken(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'token')) {
    return typeof options.token === 'string' ? options.token.trim() : '';
  }
  const fromEnv = process.env.MINNOW_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return readSessionTokenFile();
}

/**
 * @param {string} origin e.g. http://localhost:9473
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function pingMinnowApi(origin, token) {
  const base = origin.replace(/\/$/, '');
  /** @type {Record<string, string>} */
  const headers = {};
  if (token) headers['x-minnow-token'] = token;
  try {
    const res = await fetch(`${base}/api/config/ping`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

/**
 * @param {number} port
 * @param {string} token
 * @returns {Promise<string | null>}
 */
async function tryPort(port, token) {
  for (const host of ['localhost', '127.0.0.1']) {
    const origin = `http://${host}:${port}`;
    if (await pingMinnowApi(origin, token)) return origin;
  }
  return null;
}

/**
 * @param {{ timeoutMs?: number, intervalMs?: number, preferredPort?: number, token?: string | null, logLabel?: string, logIntervalMs?: number }} [options]
 * @returns {Promise<{ origin: string, port: number }>}
 */
export async function waitForMinnowDev(options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const logIntervalMs = options.logIntervalMs ?? 8_000;
  const logLabel = typeof options.logLabel === 'string' ? options.logLabel : '';
  const preferred = options.preferredPort ?? resolveMinnowPort();
  const deadline = Date.now() + timeoutMs;
  let lastProgressLog = Date.now();

  while (Date.now() < deadline) {
    const token = resolvePingToken(options);
    const state = readDevHostState();
    if (
      state?.localUrl &&
      isDevHostProcessAlive(state) &&
      (await pingMinnowApi(state.localUrl, token))
    ) {
      return { origin: state.localUrl, port: state.port };
    }

    const direct = await tryPort(preferred, token);
    if (direct) {
      const port = Number(new URL(`${direct}/`).port) || preferred;
      return { origin: direct, port };
    }

    const bumped = await tryPort(preferred + 1, token);
    if (bumped) {
      const port = Number(new URL(`${bumped}/`).port) || preferred + 1;
      return { origin: bumped, port };
    }

    if (logLabel && Date.now() - lastProgressLog >= logIntervalMs) {
      console.log(
        `${logLabel} Still waiting for dev server (Vite may be pre-bundling dependencies)…`,
      );
      lastProgressLog = Date.now();
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out waiting for Minnow dev server (expected near port ${preferred}; check server logs)`,
  );
}
