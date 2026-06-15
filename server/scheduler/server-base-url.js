/**
 * Dev-server origin for scheduler subprocesses (set once at bootstrap).
 * Vite on Windows often binds to localhost (IPv6) only, so avoid 127.0.0.1 defaults.
 */

/** @type {string} */
let serverBaseUrl = `http://localhost:${process.env.PORT || 5173}`;

/** Record the URL Vite resolved at startup (e.g. http://localhost:5173). */
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
