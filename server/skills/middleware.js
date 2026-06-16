/**
 * Skills catalog API: GET /api/skills, GET /api/skills/:id, POST create, PUT save
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSkillById, listMergedSkills, SKILL_ID_RE } from './scan.js';
import { createUserSkill, saveUserSkillContent } from './user-skills.js';
import { handleImpeccableReferenceRequest } from '../impeccable/reference-handler.js';
import { handleSynthesisRequest } from '../brain/synthesis-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  if (handleImpeccableReferenceRequest(req, res, pathname, PROJECT_ROOT)) {
    return true;
  }

  const synthesisHandled = await handleSynthesisRequest(req, res, pathname);
  if (synthesisHandled) {
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

  if (pathname === '/api/skills' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await readJsonBody(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const label = typeof body.label === 'string' ? body.label.trim() : undefined;
      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Skill id is required' }));
        return true;
      }
      const created = await createUserSkill(PROJECT_ROOT, id, label);
      const skill = await getSkillById(PROJECT_ROOT, id);
      res.statusCode = 201;
      res.end(JSON.stringify({ ok: true, path: created.path, skill }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 400;
      res.end(JSON.stringify({ error: message }));
    }
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (!SKILL_ID_RE.test(id) || id.includes('..')) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid skill id' }));
      return true;
    }

    if (req.method === 'GET') {
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

    if (req.method === 'PUT') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const body = await readJsonBody(req);
        const content = typeof body.content === 'string' ? body.content : '';
        await saveUserSkillContent(id, content);
        const skill = await getSkillById(PROJECT_ROOT, id);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, skill }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.statusCode = 400;
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }
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
