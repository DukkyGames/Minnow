/**
 * Mock Chrome DevTools HTTP + WebSocket server for CDP integration tests.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'cdp');

const TEST_TARGET_ID = 'TEST-TARGET-11111111';

/**
 * @param {{ port?: number }} [opts]
 * @returns {Promise<{ baseUrl: string; port: number; close: () => Promise<void> }>}
 */
export async function startMockCdpServer(opts = {}) {
  const listFixture = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'json-list-pages.json'), 'utf8'),
  );
  const screenshotB64 = (
    await fs.readFile(path.join(FIXTURES, 'screenshot-base64.txt'), 'utf8')
  ).trim();

  let listenPort = opts.port ?? 0;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/json/list' && req.method === 'GET') {
      const body = listFixture.map((t) => ({
        ...t,
        webSocketDebuggerUrl: t.webSocketDebuggerUrl.replace('PORT', String(listenPort)),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => {
    server.listen(listenPort, '127.0.0.1', () => {
      const addr = server.address();
      listenPort = typeof addr === 'object' && addr ? addr.port : listenPort;
      resolve();
    });
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const { id, method } = msg;
      /** @type {Record<string, unknown>} */
      let result = {};

      switch (method) {
        case 'Page.enable':
        case 'Accessibility.enable':
        case 'DOM.resolveNode':
          result = method === 'DOM.resolveNode'
            ? { object: { objectId: 'mock-object-1' } }
            : {};
          break;
        case 'Page.navigate':
          result = {};
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                method: 'Page.loadEventFired',
                params: {},
              }),
            );
          }, 5);
          break;
        case 'Runtime.evaluate':
          result = { result: { type: 'string', value: 'Mock Title' } };
          break;
        case 'Accessibility.getFullAXTree':
          result = {
            nodes: [
              {
                nodeId: '1',
                role: { value: 'RootWebArea' },
                name: { value: 'Test' },
                backendDOMNodeId: 1,
                childIds: ['2'],
              },
              {
                nodeId: '2',
                role: { value: 'button' },
                name: { value: 'Submit' },
                backendDOMNodeId: 42,
                childIds: [],
              },
            ],
          };
          break;
        case 'DOM.getBoxModel':
          result = { model: { content: [10, 10, 20, 10, 20, 20, 10, 20] } };
          break;
        case 'Input.dispatchMouseEvent':
        case 'Input.dispatchKeyEvent':
        case 'Runtime.callFunctionOn':
          result = {};
          break;
        case 'Page.captureScreenshot':
          result = { data: screenshotB64 };
          break;
        default:
          result = {};
      }

      if (id !== undefined) {
        ws.send(JSON.stringify({ id, result }));
      }
    });
  });

  const baseUrl = `http://127.0.0.1:${listenPort}`;

  return {
    baseUrl,
    port: listenPort,
    testTargetId: TEST_TARGET_ID,
    async close() {
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
