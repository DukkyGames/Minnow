/**
 * Bind the packaged in-process HTTP server to a stable loopback origin.
 * Port 0 (ephemeral) made Chromium treat every launch as a new origin, so
 * localStorage theme prefs were discarded on reboot.
 */

import type { Server } from 'node:http';

export interface LoopbackListenResult {
  port: number;
  /** True when the preferred port was taken and we fell back to an ephemeral bind. */
  ephemeral: boolean;
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE');
}

/** Listen on 127.0.0.1 at `port`. Rejects with the listen error (including EADDRINUSE). */
export function listenLoopback(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('In-process server failed to bind to 127.0.0.1'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Prefer `preferredPort` so the renderer origin stays stable across launches.
 * If that port is busy (dev server already running), fall back to an ephemeral port.
 */
export async function listenOnPreferredLoopback(
  server: Server,
  preferredPort: number,
): Promise<LoopbackListenResult> {
  try {
    const port = await listenLoopback(server, preferredPort);
    return { port, ephemeral: false };
  } catch (err) {
    if (!isAddrInUse(err)) throw err;
    const port = await listenLoopback(server, 0);
    return { port, ephemeral: true };
  }
}
