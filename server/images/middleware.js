/**
 * Gallery REST API: generation, metadata, albums, and file serving.
 */

import fs from 'node:fs/promises';
import {
  createAlbum,
  deleteImage,
  enforceCaps,
  getGalleryStats,
  getImageById,
  listAlbums,
  listImages,
  resolveGalleryImagePath,
  saveImageBytes,
} from './store.js';
import { generateImages } from './providers.js';
import { ensureMinnowLayout } from '../config/home.js';

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
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

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function handleImagesRequest(req, res, url) {
  if (url === '/api/images/ping' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url === '/api/images/stats' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, stats: await getGalleryStats() });
    return true;
  }

  if (url === '/api/images/albums' && req.method === 'GET') {
    sendJson(res, 200, { albums: await listAlbums() });
    return true;
  }

  if (url === '/api/images/albums' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const album = await createAlbum(body);
    sendJson(res, 201, { album });
    return true;
  }

  if (url === '/api/images/cleanup' && req.method === 'POST') {
    const result = await enforceCaps();
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }

  if (url === '/api/images/generate' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const generated = await generateImages(body);
    const albumId = body?.albumId ? String(body.albumId).trim() : undefined;
    const saved = [];
    for (const item of generated) {
      const image = await saveImageBytes({
        bytes: item.bytes,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt,
        providerId: item.providerId,
        model: item.model,
        params: item.params,
        albumId,
      });
      saved.push(image);
    }
    sendJson(res, 201, { images: saved });
    return true;
  }

  if (url === '/api/images' && req.method === 'GET') {
    const rawUrl = req.url ?? '';
    const qIndex = rawUrl.indexOf('?');
    const search = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
    const params = new URLSearchParams(search);
    const result = await listImages({
      albumId: params.get('albumId') ?? undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      offset: params.get('offset') ? Number(params.get('offset')) : undefined,
    });
    sendJson(res, 200, result);
    return true;
  }

  const fileMatch = url.match(/^\/api\/images\/([^/]+)\/file$/);
  if (fileMatch && req.method === 'GET') {
    const image = await getImageById(fileMatch[1]);
    if (!image) {
      sendJson(res, 404, { error: 'Image not found' });
      return true;
    }
    let abs;
    try {
      abs = resolveGalleryImagePath(image.filePath);
    } catch {
      sendJson(res, 400, { error: 'Invalid image path' });
      return true;
    }
    try {
      const bytes = await fs.readFile(abs);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(bytes);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        sendJson(res, 404, { error: 'File not found' });
      } else {
        throw err;
      }
    }
    return true;
  }

  const thumbMatch = url.match(/^\/api\/images\/([^/]+)\/thumbnail$/);
  if (thumbMatch && req.method === 'GET') {
    const image = await getImageById(thumbMatch[1]);
    if (!image) {
      sendJson(res, 404, { error: 'Image not found' });
      return true;
    }
    let abs;
    try {
      abs = resolveGalleryImagePath(image.filePath);
    } catch {
      sendJson(res, 400, { error: 'Invalid image path' });
      return true;
    }
    try {
      const bytes = await fs.readFile(abs);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(bytes);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        sendJson(res, 404, { error: 'File not found' });
      } else {
        throw err;
      }
    }
    return true;
  }

  const idMatch = url.match(/^\/api\/images\/([^/]+)$/);
  if (idMatch && req.method === 'GET') {
    const image = await getImageById(idMatch[1]);
    if (!image) {
      sendJson(res, 404, { error: 'Image not found' });
      return true;
    }
    sendJson(res, 200, { image });
    return true;
  }

  if (idMatch && req.method === 'DELETE') {
    await deleteImage(idMatch[1]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

export function createImagesMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/images')) {
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
      const handled = await handleImagesRequest(req, res, url);
      if (!handled) {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : /required|invalid|rejected|exceeds/i.test(message) ? 400 : 500;
      sendJson(res, status, { error: message });
    }
  };
}
