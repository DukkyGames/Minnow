/**
 * WebSocket bridge for live TTS streaming (/api/tts/ws).
 */

import { WebSocketServer } from 'ws';
import { parseClientMessage, formatServerMessage } from './tts-protocol.js';
import { TtsStreamSession } from './stream-session.js';
import { getNetworkAccess, isClientAllowed, isHostAllowed } from '../network/access.js';
import { getSessionToken, timingSafeEqualToken } from '../runtime/session-token.js';

/**
 * Attach TTS WebSocket server to the HTTP server.
 * @param {import('http').Server} httpServer
 */
export function attachTtsWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/tts/ws') {
      return;
    }

    if (!isClientAllowed(req, getNetworkAccess()) || !isHostAllowed(req.headers.host ?? '', getNetworkAccess())) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token') ?? '';
    if (!timingSafeEqualToken(token, getSessionToken())) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const session = new TtsStreamSession(ws);

      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const parsed = parseClientMessage(text);
        if (!parsed) return;
        if (parsed.type === 'start') {
          void session.handleStart(parsed);
        } else if (parsed.type === 'cancel') {
          void session.handleCancel();
        } else if (parsed.type === 'ping') {
          ws.send(formatServerMessage('ready', { sampleRate: 24000 }));
        }
      });

      const cleanup = () => {
        void session.dispose();
      };

      ws.on('close', cleanup);
      req.on('close', cleanup);
    });
  });

  return wss;
}
