/**
 * HTTP handlers for /api/desktop-workspace/* (Vite configureServer middleware).
 */

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { countDesktopWorkspaceFiles, listDesktopWorkspaceDirectory } from './list.js';
import {
  getDesktopWorkspacePath,
  resolveSafeDesktopPath,
  setDesktopWorkspacePath,
  toDesktopRelativePath,
} from './paths.js';
import { workspaceLabel } from '../workspace/root.js';

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

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Guess a simple content type for download responses.
 * @param {string} filePath
 */
function contentTypeForDownload(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Handle /api/desktop-workspace requests. Returns true when handled.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {URLSearchParams} searchParams
 */
export async function handleDesktopWorkspaceRequest(req, res, pathname, searchParams = new URLSearchParams()) {
  if (!pathname.startsWith('/api/desktop-workspace')) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/desktop-workspace' && req.method === 'GET') {
      const desktopPath = getDesktopWorkspacePath();
      const fileCount = await countDesktopWorkspaceFiles();
      sendJson(res, 200, {
        ok: true,
        path: desktopPath,
        label: workspaceLabel(desktopPath),
        fileCount,
      });
      return true;
    }

    if (pathname === '/api/desktop-workspace' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const userPath = body?.path;
      if (typeof userPath !== 'string' || !userPath.trim()) {
        sendJson(res, 400, { error: 'path is required' });
        return true;
      }
      const resolved = await setDesktopWorkspacePath(userPath);
      const fileCount = await countDesktopWorkspaceFiles();
      sendJson(res, 200, {
        ok: true,
        path: resolved,
        label: workspaceLabel(resolved),
        fileCount,
      });
      return true;
    }

    if (pathname === '/api/desktop-workspace/list' && req.method === 'GET') {
      const listPath = searchParams.get('path') ?? '';
      const listing = await listDesktopWorkspaceDirectory(listPath);
      sendJson(res, 200, { ok: true, ...listing });
      return true;
    }

    if (pathname === '/api/desktop-workspace/download' && req.method === 'GET') {
      const downloadPath = searchParams.get('path');
      if (!downloadPath || !downloadPath.trim()) {
        sendJson(res, 400, { error: 'path is required' });
        return true;
      }

      const filePath = resolveSafeDesktopPath(downloadPath);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        sendJson(res, 400, { error: 'Path must be a file' });
        return true;
      }

      const filename = path.basename(filePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeForDownload(filePath));
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('X-Desktop-Relative-Path', toDesktopRelativePath(filePath));

      const stream = createReadStream(filePath);
      stream.on('error', (err) => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
          return;
        }
        res.destroy(err);
      });
      stream.pipe(res);
      return true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
    return true;
  }

  if (pathname.startsWith('/api/desktop-workspace')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}
