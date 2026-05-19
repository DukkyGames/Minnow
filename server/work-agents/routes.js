/**
 * HTTP middleware for /api/work-agents
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidWorkAgentId,
  workAgentPromptOverridePath,
} from './paths.js';
import {
  getWorkAgentById,
  loadWorkAgentRegistry,
  patchWorkAgentOverride,
  readWorkAgentPrompt,
  writeWorkAgentPromptOverride,
} from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
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

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {string} search
 * @returns {Promise<boolean>}
 */
export async function handleWorkAgentsRequest(req, res, pathname, search) {
  if (!pathname.startsWith('/api/work-agents')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/work-agents' && req.method === 'GET') {
      const snapshot = await loadWorkAgentRegistry(PROJECT_ROOT);
      sendJson(res, 200, { agents: snapshot.agents, overrides: snapshot.overrides });
      return true;
    }

    const agentMatch = pathname.match(/^\/api\/work-agents\/([a-z][a-z0-9-]{0,63})$/);
    if (agentMatch && req.method === 'GET') {
      const agentId = agentMatch[1];
      const agent = await getWorkAgentById(PROJECT_ROOT, agentId);
      if (!agent) {
        sendJson(res, 404, { error: 'Work agent not found' });
        return true;
      }
      sendJson(res, 200, { agent });
      return true;
    }

    if (agentMatch && req.method === 'PUT') {
      const agentId = agentMatch[1];
      assertValidWorkAgentId(agentId);
      const body = await readJsonBody(req);
      const patch = {};
      if ('providerId' in body) patch.providerId = body.providerId;
      if ('modelId' in body) patch.modelId = body.modelId;
      if ('promptOverride' in body) patch.promptOverride = body.promptOverride;
      if ('disabled' in body) patch.disabled = body.disabled;
      await patchWorkAgentOverride(agentId, patch);
      const agent = await getWorkAgentById(PROJECT_ROOT, agentId);
      sendJson(res, 200, { agent });
      return true;
    }

    const promptMatch = pathname.match(
      /^\/api\/work-agents\/([a-z][a-z0-9-]{0,63})\/prompt$/,
    );
    if (promptMatch) {
      const agentId = promptMatch[1];
      assertValidWorkAgentId(agentId);

      const params = new URLSearchParams(search);
      const profile = params.get('profile') === 'lite' ? 'lite' : 'full';

      if (req.method === 'GET') {
        const agent = await getWorkAgentById(PROJECT_ROOT, agentId);
        if (!agent) {
          sendJson(res, 404, { error: 'Work agent not found' });
          return true;
        }
        const result = await readWorkAgentPrompt(PROJECT_ROOT, agentId, profile);
        sendJson(res, 200, result);
        return true;
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const writeProfile = body.profile === 'lite' ? 'lite' : 'full';
        const content = typeof body.content === 'string' ? body.content : '';
        await writeWorkAgentPromptOverride(agentId, writeProfile, content);
        workAgentPromptOverridePath(agentId, writeProfile);
        const result = await readWorkAgentPrompt(PROJECT_ROOT, agentId, writeProfile);
        sendJson(res, 200, result);
        return true;
      }
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Invalid') ? 400 : 500;
    sendJson(res, status, { error: message });
    return true;
  }
}

/**
 * Vite connect middleware factory.
 */
export function createWorkAgentsMiddleware() {
  return async (req, res, next) => {
    const url = req.url ?? '';
    const q = url.indexOf('?');
    const pathname = q >= 0 ? url.slice(0, q) : url;
    const search = q >= 0 ? url.slice(q) : '';

    const handled = await handleWorkAgentsRequest(req, res, pathname, search);
    if (handled) return;
    next();
  };
}
