/**
 * WebSocket bridge for interactive PTY sessions (/api/terminal/ws).
 */

import { WebSocketServer } from 'ws';
import { parseClientMessage, formatServerMessage } from './pty-protocol.js';
import {
  getPtySession,
  subscribePtySession,
  writePtySession,
  resizePtySession,
  destroyPtySession,
} from './pty-host.js';

/** @param {import('http').IncomingMessage} req */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? '';
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.endsWith('127.0.0.1')
  );
}

/**
 * Attach PTY WebSocket server to the Vite HTTP server.
 * @param {import('http').Server} httpServer
 */
export function attachPtyWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/terminal/ws') {
      return;
    }

    if (!isLoopback(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get('sessionId') ?? '';
    const session = getPtySession(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(
        formatServerMessage('meta', {
          sessionId,
          shell: session.shell,
          shellProfileId: session.shellProfileId,
        }),
      );

      if (session.scrollback) {
        ws.send(formatServerMessage('output', { data: session.scrollback }));
      }

      const unsubscribe = subscribePtySession(sessionId, (msg) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      });

      ws.on('message', (data) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const parsed = parseClientMessage(text);
        if (!parsed) return;
        try {
          if (parsed.type === 'input') {
            writePtySession(sessionId, parsed.data);
          } else if (parsed.type === 'resize') {
            resizePtySession(sessionId, parsed.cols, parsed.rows);
          }
        } catch {
          /* session ended */
        }
      });

      const cleanup = () => {
        unsubscribe();
      };

      ws.on('close', cleanup);
      req.on('close', cleanup);
    });
  });

  return wss;
}
