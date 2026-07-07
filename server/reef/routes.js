/**
 * HTTP handlers for /api/reef/artifacts/* (Vite configureServer middleware).
 */

import {
  listArtifacts,
  createArtifact,
  getArtifactWithCurrentBody,
  readArtifactVersion,
  appendArtifactVersion,
} from './artifact-store.js';
import { isValidReefArtifactId } from './artifact-paths.js';
import { getMinnowHome } from '../config/home.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
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

/**
 * Handle /api/reef requests. Returns true if handled.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 */
export async function handleReefRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/reef')) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/reef/ping' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, home: getMinnowHome() });
      return true;
    }

    if (pathname === '/api/reef/artifacts' && req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const artifacts = await listArtifacts({
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      sendJson(res, 200, { artifacts });
      return true;
    }

    if (pathname === '/api/reef/artifacts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const created = await createArtifact({
        id: body.id,
        title: body.title,
        body: body.body ?? '',
        author: body.author,
        refs: body.refs,
        source: body.source,
        chatIds: body.chatIds,
      });
      sendJson(res, 201, {
        id: created.manifest.id,
        manifest: created.manifest,
        body: created.body,
      });
      return true;
    }

    const versionMatch = pathname.match(/^\/api\/reef\/artifacts\/([^/]+)\/versions\/(\d+)$/);
    if (versionMatch && req.method === 'GET') {
      const id = decodeURIComponent(versionMatch[1]);
      const version = Number(versionMatch[2]);
      if (!isValidReefArtifactId(id) || !Number.isInteger(version) || version < 1) {
        sendJson(res, 400, { error: 'Invalid artifact id or version' });
        return true;
      }
      const row = await readArtifactVersion(id, version);
      if (!row) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      sendJson(res, 200, row);
      return true;
    }

    const idMatch = pathname.match(/^\/api\/reef\/artifacts\/([^/]+)$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      if (!isValidReefArtifactId(id)) {
        sendJson(res, 400, { error: 'Invalid artifact id' });
        return true;
      }

      if (req.method === 'GET') {
        const row = await getArtifactWithCurrentBody(id);
        if (!row) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, row);
        return true;
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        try {
          const result = await appendArtifactVersion(id, {
            body: body.body ?? '',
            author: body.author,
            refs: body.refs,
            summary: body.summary,
            expectedVersion: body.expectedVersion,
          });
          sendJson(res, 200, result);
        } catch (err) {
          if (err && typeof err === 'object' && err.code === 'VERSION_CONFLICT') {
            sendJson(res, 409, {
              error: 'Version conflict',
              currentVersion: err.currentVersion,
            });
            return true;
          }
          throw err;
        }
        return true;
      }
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    sendJson(res, 500, { error: message });
    return true;
  }
}
