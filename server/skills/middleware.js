/**
 * Skills catalog API: GET /api/skills, GET /api/skills/:id
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSkillById, listMergedSkills, SKILL_ID_RE } from './scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>} true if handled
 */
export async function handleSkillsRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/skills')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (pathname === '/api/skills/ping' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (pathname === '/api/skills' && req.method === 'GET') {
    const skills = await listMergedSkills(PROJECT_ROOT);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ skills }));
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (detailMatch && req.method === 'GET') {
    const id = decodeURIComponent(detailMatch[1]);
    if (!SKILL_ID_RE.test(id) || id.includes('..')) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid skill id' }));
      return true;
    }

    const skill = await getSkillById(PROJECT_ROOT, id);
    if (!skill) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Skill not found' }));
      return true;
    }

    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ skill }));
    return true;
  }

  if (pathname.startsWith('/api/skills')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
    return true;
  }

  return false;
}

/**
 * Connect middleware for Vite dev server.
 * @returns {(req: import('connect').IncomingMessage, res: import('http').ServerResponse, next: () => void) => void}
 */
export function createSkillsMiddleware() {
  return (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/skills')) {
      next();
      return;
    }

    void handleSkillsRequest(req, res, url).then((handled) => {
      if (!handled) next();
    });
  };
}
