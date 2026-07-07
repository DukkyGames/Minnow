/**
 * In-process HTTP server for packaged Electron (MIN-111).
 * Connect API middleware + sirv static dist + PTY WebSocket on a dynamic localhost port.
 */

import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import connect from 'connect';
import sirv from 'sirv';
import { importServerModule } from './server-import.js';

/** True for GET/HEAD requests that should receive the SPA's index.html (mirrors sirv's `single: true` fallback heuristic). */
function isHtmlNavigationRequest(req: http.IncomingMessage): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const accept = req.headers.accept ?? '';
  if (accept.includes('text/html')) return true;
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

export interface InProcessServerHandle {
  url: string;
  close(): Promise<void>;
}

/**
 * Start Minnow API + static dist on a dynamic localhost port (production Electron).
 */
export async function startInProcessServer(): Promise<InProcessServerHandle> {
  const [
    { applyMinnowMiddlewares },
    { resolveSafePath, runWithPathAccess },
    { attachPtyWebSocketServer },
    { attachSttWebSocketServer },
    { attachTtsWebSocketServer },
    { getAppRoot },
    { getSessionToken, injectSessionTokenScript },
  ] = await Promise.all([
    importServerModule<{
      applyMinnowMiddlewares: (
        connectApp: connect.Server,
        deps: {
          resolveSafePath: (userPath: string, options?: { write?: boolean }) => string;
          runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T>;
        },
      ) => void;
    }>('runtime/middlewares.js'),
    importServerModule<{
      resolveSafePath: (userPath: string, options?: { write?: boolean }) => string;
      runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T>;
    }>('runtime/path-access.js'),
    importServerModule<{
      attachPtyWebSocketServer: (httpServer: http.Server) => void;
    }>('terminal/pty-ws.js'),
    importServerModule<{
      attachSttWebSocketServer: (httpServer: http.Server) => void;
    }>('stt/stt-ws.js'),
    importServerModule<{
      attachTtsWebSocketServer: (httpServer: http.Server) => void;
    }>('tts/tts-ws.js'),
    importServerModule<{ getAppRoot: () => string }>('workspace/root.js'),
    importServerModule<{
      getSessionToken: () => string;
      injectSessionTokenScript: (html: string, token: string) => string;
    }>('runtime/session-token.js'),
  ]);

  const connectApp = connect();

  // Register /api/* handlers before the SPA fallback (same order as server.js + Vite).
  applyMinnowMiddlewares(connectApp, { resolveSafePath, runWithPathAccess });

  const distDir = path.join(getAppRoot(), 'dist');

  // Inject the session token into the SPA shell so same-origin renderer code can
  // read it; a cross-origin page never sees this HTML per same-origin policy.
  connectApp.use(async (req, res, next) => {
    if (!isHtmlNavigationRequest(req)) {
      next();
      return;
    }
    try {
      const html = await fsp.readFile(path.join(distDir, 'index.html'), 'utf8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(injectSessionTokenScript(html, getSessionToken()));
    } catch {
      next();
    }
  });

  connectApp.use(
    sirv(distDir, {
      single: true,
      dev: false,
    }),
  );

  const server = http.createServer(connectApp);
  attachPtyWebSocketServer(server);
  attachSttWebSocketServer(server);
  attachTtsWebSocketServer(server);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('In-process server failed to bind to 127.0.0.1');
  }

  const url = `http://127.0.0.1:${address.port}/`;
  console.log(`Minnow in-process server: ${url}`);

  return {
    url,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
