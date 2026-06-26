/**
 * Dev-server origin for scheduler subprocesses (set once at bootstrap).
 * Vite on Windows often binds to localhost (IPv6) only, so avoid 127.0.0.1 defaults.
 */

import { defaultMinnowLocalOrigin } from '../constants/minnow-port.js';

/** @type {string} */
let serverBaseUrl = defaultMinnowLocalOrigin();

/** Record the URL Vite resolved at startup (e.g. http://localhost:9473). */
export function setSchedulerServerBaseUrl(url) {
  const trimmed = String(url ?? '').trim().replace(/\/$/, '');
  if (trimmed) {
    serverBaseUrl = trimmed;
  }
}

/** Origin passed to `minnow run --base-url` when a job runs. */
export function getSchedulerServerBaseUrl() {
  return serverBaseUrl;
}
