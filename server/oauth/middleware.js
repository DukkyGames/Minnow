/**
 * OAuth REST API middleware (/api/oauth/*).
 */

import { ensureMinnowLayout } from '../config/home.js';
import { loadOAuthCredentialsForApi } from './credentials.js';
import { listOAuthConnections, getOAuthConnection, redactConnection } from './connections.js';
import {
  startOAuthFlow,
  handleOAuthCallback,
  oauthCallbackSuccessHtml,
  oauthCallbackErrorHtml,
  refreshConnectionTokensIfNeeded,
} from './flow.js';
import { disconnectOAuthConnection } from './provision.js';
import { getOAuthRedirectUri } from './redirect-base.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url) {
  return new URL(url, 'http://localhost').searchParams;
}

export function createOAuthMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/oauth')) {
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
      await ensureMinnowLayout();

      if (url === '/api/oauth/ping' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, redirectUri: getOAuthRedirectUri() });
        return;
      }

      if (url === '/api/oauth/config' && req.method === 'GET') {
        const credentials = await loadOAuthCredentialsForApi();
        sendJson(res, 200, { credentials, redirectUri: getOAuthRedirectUri() });
        return;
      }

      if (url === '/api/oauth/start' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await startOAuthFlow({
          provider: body.provider,
          services: body.services,
          label: body.label,
        });
        sendJson(res, 200, result);
        return;
      }

      if (url === '/api/oauth/callback' && req.method === 'GET') {
        const params = parseQuery(req.url ?? '');
        try {
          await handleOAuthCallback({
            code: params.get('code') ?? undefined,
            state: params.get('state') ?? undefined,
            error: params.get('error') ?? undefined,
            error_description: params.get('error_description') ?? undefined,
          });
          sendHtml(res, 200, oauthCallbackSuccessHtml());
        } catch (err) {
          const message = err instanceof Error ? err.message : 'OAuth callback failed';
          sendHtml(res, 400, oauthCallbackErrorHtml(message));
        }
        return;
      }

      if (url === '/api/oauth/connections' && req.method === 'GET') {
        const connections = await listOAuthConnections();
        sendJson(res, 200, {
          connections: connections.map(redactConnection),
        });
        return;
      }

      const connectionMatch = url.match(/^\/api\/oauth\/connections\/([^/]+)(?:\/(.+))?$/);
      if (connectionMatch) {
        const connectionId = decodeURIComponent(connectionMatch[1]);
        const tail = connectionMatch[2] ?? '';

        if (!tail && req.method === 'GET') {
          const connection = await getOAuthConnection(connectionId);
          if (!connection) {
            sendJson(res, 404, { error: 'OAuth connection not found' });
            return;
          }
          sendJson(res, 200, { connection: redactConnection(connection) });
          return;
        }

        if (tail === 'refresh' && req.method === 'POST') {
          await refreshConnectionTokensIfNeeded(connectionId);
          const connection = await getOAuthConnection(connectionId);
          sendJson(res, 200, { connection: redactConnection(connection) });
          return;
        }

        if (!tail && req.method === 'DELETE') {
          await disconnectOAuthConnection(connectionId);
          sendJson(res, 200, { deleted: true });
          return;
        }
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth request failed';
      sendJson(res, 400, { error: message });
    }
  };
}
