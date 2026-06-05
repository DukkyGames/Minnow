/**
 * /api/servers/* middleware for managed local servers.
 */

import { getMinnowHome } from '../config/home.js';
import {
  getInstallStatus,
  getServerJob,
  getServerLogs,
  listServers,
  startInstallServer,
  restartServer,
  setServerAutoStart,
  setServerEnabled,
  setServerPort,
  startServer,
  stopServer,
  uninstallServer,
} from './manager.js';
import { getServerDef } from './catalog.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createServersMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/servers')) {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url === '/api/servers/ping' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          homeDir: getMinnowHome(),
          serverCount: (await listServers()).length,
        });
        return;
      }

      if (url === '/api/servers' && req.method === 'GET') {
        sendJson(res, 200, { servers: await listServers() });
        return;
      }

      const installMatch = url.match(/^\/api\/servers\/([^/]+)\/install$/);
      if (installMatch && req.method === 'POST') {
        const id = decodeURIComponent(installMatch[1]);
        const result = await startInstallServer(id);
        sendJson(res, 200, { ...result, job: getServerJob(id) });
        return;
      }

      const startMatch = url.match(/^\/api\/servers\/([^/]+)\/start$/);
      if (startMatch && req.method === 'POST') {
        const id = decodeURIComponent(startMatch[1]);
        const result = await startServer(id);
        sendJson(res, 200, result);
        return;
      }

      const stopMatch = url.match(/^\/api\/servers\/([^/]+)\/stop$/);
      if (stopMatch && req.method === 'POST') {
        const id = decodeURIComponent(stopMatch[1]);
        const result = await stopServer(id);
        sendJson(res, 200, result);
        return;
      }

      const restartMatch = url.match(/^\/api\/servers\/([^/]+)\/restart$/);
      if (restartMatch && req.method === 'POST') {
        const id = decodeURIComponent(restartMatch[1]);
        const result = await restartServer(id);
        sendJson(res, 200, result);
        return;
      }

      const logsMatch = url.match(/^\/api\/servers\/([^/]+)\/logs$/);
      if (logsMatch && req.method === 'GET') {
        const id = decodeURIComponent(logsMatch[1]);
        if (!getServerDef(id)) {
          sendJson(res, 404, { error: 'Unknown server' });
          return;
        }
        const lines = getServerLogs(id);
        sendJson(res, 200, { serverId: id, lines });
        return;
      }

      const enabledMatch = url.match(/^\/api\/servers\/([^/]+)\/enabled$/);
      if (enabledMatch && req.method === 'PUT') {
        const id = decodeURIComponent(enabledMatch[1]);
        const body = await readJsonBody(req);
        const entry = await setServerEnabled(id, body.enabled !== false);
        sendJson(res, 200, { ok: true, server: entry });
        return;
      }

      const autoStartMatch = url.match(/^\/api\/servers\/([^/]+)\/autostart$/);
      if (autoStartMatch && req.method === 'PUT') {
        const id = decodeURIComponent(autoStartMatch[1]);
        const body = await readJsonBody(req);
        const entry = await setServerAutoStart(id, body.autoStart !== false);
        sendJson(res, 200, { ok: true, server: entry });
        return;
      }

      const portMatch = url.match(/^\/api\/servers\/([^/]+)\/port$/);
      if (portMatch && req.method === 'PUT') {
        const id = decodeURIComponent(portMatch[1]);
        const body = await readJsonBody(req);
        const entry = await setServerPort(id, body.port);
        sendJson(res, 200, { ok: true, server: entry });
        return;
      }

      const serverMatch = url.match(/^\/api\/servers\/([^/]+)$/);
      if (serverMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(serverMatch[1]);
        await uninstallServer(id);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (serverMatch && req.method === 'GET') {
        const id = decodeURIComponent(serverMatch[1]);
        sendJson(res, 200, { status: await getInstallStatus(id) });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes('Unknown') || message.includes('not installed')
          ? 400
          : message.includes('Port must')
            ? 400
            : 500;
      sendJson(res, status, { error: message });
    }
  };
}
