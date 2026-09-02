/**
 * Shared HTTP health wait for llama.cpp serve settle and managed servers.
 *
 * Two copies used to drift: serve.js probed `/health` + `/v1/models`, watched the
 * background run, and returned `{ ok, error, logTail, exitCode }` for Phase 3
 * diagnose; manager.js took `healthPath` and threw on timeout. One helper keeps
 * manager's `healthPath` and serve's structured result + run-exit.
 */

import { MODEL_LOAD_TIMEOUT_MS } from './timeouts.js';

/**
 * @typedef {{ ok: true } | { ok: false, error: string, logTail?: string, exitCode?: number | null }} HealthWaitResult
 */

/**
 * Tests may pass `{ status: 200 }` without `ok`; real fetch sets both.
 * @param {Response | { ok?: boolean, status?: number }} res
 */
function isHealthyResponse(res) {
  if (!res) return false;
  if (res.status === 200) return true;
  return res.ok === true;
}

/**
 * @param {string} origin
 * @param {string} healthPath
 */
function joinOriginPath(origin, healthPath) {
  const base = String(origin || '').replace(/\/$/, '');
  const path = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
  return `${base}${path}`;
}

/**
 * Poll until a health URL answers, the deadline hits, or an optional run exits.
 * Backoff starts fast then eases off so a slow spawn is not polled at 1 Hz.
 *
 * @param {object} opts
 * @param {string} opts.healthPath Primary path (manager: `/healthz`, `/v1/models`, …).
 * @param {string} [opts.baseUrl] Origin. Required unless `port` is set.
 * @param {number} [opts.port] Used as `http://127.0.0.1:${port}` when `baseUrl` is omitted.
 * @param {string[]} [opts.extraPaths] Extra paths to try each tick (serve.js also hits `/v1/models`).
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.runId] When set, a finished background run aborts the wait.
 * @param {(runId: string) => { finished?: boolean, exitCode?: number | null } | null | undefined} [opts.getRun]
 * @param {(runId: string) => Promise<string | null | undefined>} [opts.readLogTail]
 * @param {string} [opts.label] Timeout / exit error prefix (serve.js: `llama-server`).
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<HealthWaitResult>}
 */
export async function waitForHealth(opts) {
  const healthPath = opts?.healthPath;
  if (typeof healthPath !== 'string' || !healthPath.trim()) {
    throw new Error('waitForHealth requires healthPath');
  }
  const origin =
    typeof opts.baseUrl === 'string' && opts.baseUrl.trim()
      ? opts.baseUrl.replace(/\/$/, '')
      : typeof opts.port === 'number'
        ? `http://127.0.0.1:${opts.port}`
        : '';
  if (!origin) {
    throw new Error('waitForHealth requires baseUrl or port');
  }

  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : MODEL_LOAD_TIMEOUT_MS;
  const extraPaths = Array.isArray(opts.extraPaths) ? opts.extraPaths : [];
  const paths = [healthPath.trim(), ...extraPaths.filter((p) => typeof p === 'string' && p.trim())];
  const urls = [...new Set(paths.map((p) => joinOriginPath(origin, p)))];
  const label = typeof opts.label === 'string' && opts.label.trim() ? opts.label.trim() : 'server';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let delayMs = 250;

  while (Date.now() < deadline) {
    if (opts.runId && typeof opts.getRun === 'function') {
      const run = opts.getRun(opts.runId);
      if (run?.finished) {
        const tail =
          typeof opts.readLogTail === 'function' ? await opts.readLogTail(opts.runId) : '';
        return {
          ok: false,
          error: `${label} exited before becoming healthy`,
          logTail: tail ?? '',
          exitCode: run.exitCode ?? null,
        };
      }
    }

    for (const url of urls) {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const res = await fetchImpl(url, {
          signal: AbortSignal.timeout(Math.min(5_000, remaining)),
        });
        if (isHealthyResponse(res)) return { ok: true };
      } catch {
      }
    }

    const waitMs = Math.min(delayMs, deadline - Date.now());
    if (waitMs <= 0) break;
    await new Promise((r) => setTimeout(r, waitMs));
    delayMs = Math.min(delayMs * 1.5, 3_000);
  }

  return { ok: false, error: `${label} did not become healthy in time` };
}
