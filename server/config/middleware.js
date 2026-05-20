/**
 * Express-style middleware for /api/config/* (Vite configureServer).
 */

import { ensureSpeedChatLayout, getSpeedChatHome } from './home.js';
import { readResource, writeResource, readConfigJson, writeConfigJson, configFileExists } from './store.js';
import {
  validateSessionState,
  normalizeToolConfig,
  validateSystemPromptSettings,
  mergeConfigMeta,
} from './validators.js';
import { resolveConfigPath, ALLOWED_CONFIG_FILES } from './paths.js';

const MAX_MIGRATE_BYTES = 10 * 1024 * 1024;

const STORAGE_KEYS = {
  sessions: 'speedchat-sessions-v1',
  tools: 'speedchat.tools',
  systemPrompt: 'speedchat.systemPrompt',
};

/** CORS headers aligned with /api/tools. */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
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
 * Run migration from browser localStorage payloads.
 * @param {object} body
 */
async function handleMigrate(body) {
  const warnings = [];
  const written = [];

  await ensureSpeedChatLayout();

  const meta = (await readConfigJson('config.json')) ?? {};
  if (meta.migratedFromLocalStorage === true) {
    return { ok: true, skipped: true, migrated: true, written: [], warnings: [] };
  }

  const ls = body?.localStorage && typeof body.localStorage === 'object' ? body.localStorage : {};
  const force = body?.force === true && process.env.SPEEDCHAT_DEBUG === '1';

  const migrations = [
    {
      key: 'sessions',
      raw: ls.sessions,
      file: 'sessions/state.json',
      parse: (str) => validateSessionState(JSON.parse(str)),
    },
    {
      key: 'tools',
      raw: ls.tools,
      file: 'tools.json',
      parse: (str) => normalizeToolConfig(JSON.parse(str)),
    },
    {
      key: 'systemPrompt',
      raw: ls.systemPrompt,
      file: 'system-prompt.json',
      parse: (str) => validateSystemPromptSettings(JSON.parse(str)),
    },
  ];

  const keysMigrated = [];

  for (const item of migrations) {
    if (typeof item.raw !== 'string' || !item.raw.trim()) continue;

    try {
      const parsed = item.parse(item.raw);
      if (force === false && (await configFileExists(item.file)) && meta.migratedFromLocalStorage) {
        warnings.push(`${item.file} already exists; skipped`);
        continue;
      }
      await writeConfigJson(item.file, parsed);
      written.push(item.file);
      if (item.key === 'sessions') keysMigrated.push(STORAGE_KEYS.sessions);
      if (item.key === 'tools') keysMigrated.push(STORAGE_KEYS.tools);
      if (item.key === 'systemPrompt') keysMigrated.push(STORAGE_KEYS.systemPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`${item.key}: ${message}`);
    }
  }

  const hasAnyLocal =
    (typeof ls.sessions === 'string' && ls.sessions.trim()) ||
    (typeof ls.tools === 'string' && ls.tools.trim()) ||
    (typeof ls.systemPrompt === 'string' && ls.systemPrompt.trim());

  if (hasAnyLocal || written.length > 0) {
    const merged = mergeConfigMeta(meta, {
      migratedFromLocalStorage: true,
      migratedAt: new Date().toISOString(),
      localStorageKeysMigrated: [
        ...new Set([...(meta.localStorageKeysMigrated ?? []), ...keysMigrated]),
      ],
    });
    await writeConfigJson('config.json', merged);
  }

  return {
    ok: true,
    migrated: true,
    skipped: false,
    written,
    warnings,
  };
}

/**
 * Core request handler (exported for tests).
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>} true if handled
 */
export async function handleConfigRequest(req, res, pathname) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/config/ping' && req.method === 'GET') {
      await ensureSpeedChatLayout();
      const debug = process.env.SPEEDCHAT_DEBUG === '1';
      sendJson(res, 200, {
        ok: true,
        home: '.speedchat',
        homeResolved: true,
        ...(debug ? { homePath: getSpeedChatHome() } : {}),
      });
      return true;
    }

    if (pathname === '/api/config/status' && req.method === 'GET') {
      await ensureSpeedChatLayout();
      const meta = (await readConfigJson('config.json')) ?? {};
      sendJson(res, 200, {
        ok: true,
        storage: 'home',
        migrated: meta.migratedFromLocalStorage === true,
        schemaVersion: meta.schemaVersion ?? 1,
      });
      return true;
    }

    if (pathname === '/api/config/migrate' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const payload = JSON.stringify(body ?? {});
      if (Buffer.byteLength(payload, 'utf8') > MAX_MIGRATE_BYTES) {
        sendJson(res, 400, { error: 'Migration payload too large' });
        return true;
      }
      const result = await handleMigrate(body);
      sendJson(res, 200, result);
      return true;
    }

    const resourceMatch = pathname.match(
      /^\/api\/config\/(sessions|tools|skills|system-prompt|sub-agents|meta)$/,
    );
    if (resourceMatch) {
      const resource = resourceMatch[1];

      if (req.method === 'GET') {
        const data = await readResource(resource);
        sendJson(res, 200, data);
        return true;
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const saved = await writeResource(resource, body);
        sendJson(res, 200, { ok: true, data: saved });
        return true;
      }
    }

    /** Generic file API with whitelist (traversal tests). */
    const fileMatch = pathname === '/api/config/file';
    if (fileMatch) {
      const url = new URL(req.url ?? '', 'http://localhost');
      const key = url.searchParams.get('key') ?? '';

      if (req.method === 'GET') {
        try {
          resolveConfigPath(key);
        } catch {
          sendJson(res, 400, { error: 'Invalid config path' });
          return true;
        }
        const data = await readConfigJson(key);
        if (data === null) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, data);
        return true;
      }

      if (req.method === 'PUT') {
        try {
          resolveConfigPath(key);
        } catch {
          sendJson(res, 400, { error: 'Invalid config path' });
          return true;
        }
        const body = await readJsonBody(req);
        await writeConfigJson(key, body);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    /** Reject traversal attempts on path-style URLs. */
    if (pathname.startsWith('/api/config/') && pathname.includes('..')) {
      sendJson(res, 400, { error: 'Invalid config path' });
      return true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Invalid config path' || message.includes('Invalid config')) {
      sendJson(res, 400, { error: 'Invalid config path' });
      return true;
    }
    console.error('[config]', message);
    sendJson(res, 500, { error: message });
    return true;
  }

  if (pathname.startsWith('/api/config')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

/** Connect middleware for Vite dev server. */
export function createConfigMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/config')) {
      next();
      return;
    }

    const handled = await handleConfigRequest(req, res, url);
    if (!handled) {
      next();
    }
  };
}

export { ALLOWED_CONFIG_FILES, resolveConfigPath };
