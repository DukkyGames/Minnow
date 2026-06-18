#!/usr/bin/env node
/**
 * Poll the dev server until Vite returns HTTP 200.
 * First cold start can take a while while dependencies are pre-bundled.
 */

/**
 * @param {number | string} port
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 */
export async function waitForVite(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const hosts = ['localhost', '127.0.0.1'];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const host of hosts) {
      const devUrl = `http://${host}:${port}/`;
      try {
        const res = await fetch(devUrl, { method: 'GET' });
        if (res.ok) return devUrl;
      } catch {
        // Host not ready yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for Vite on port ${port}`);
}
