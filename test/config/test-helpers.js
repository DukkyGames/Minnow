/**
 * Shared helpers for config API tests (temp SPEEDCHAT_HOME + minimal HTTP server).
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resetSpeedChatHomeCache } from '../../server/config/home.js';
import { handleConfigRequest } from '../../server/config/middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, '../fixtures/migration');

/** Fixed suffix for deterministic temp home paths. */
export const TEST_HOME_SUFFIX = 'speedchat-test-step02';

export function setTestHome(env, suffix = TEST_HOME_SUFFIX) {
  resetSpeedChatHomeCache();
  const dir = path.join(os.tmpdir(), `${suffix}-${process.pid}`);
  env.SPEEDCHAT_HOME = dir;
  return dir;
}

export async function rmTestHome(dir) {
  resetSpeedChatHomeCache();
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function readFixture(name) {
  const raw = await fs.readFile(path.join(FIXTURES_DIR, name), 'utf8');
  return raw.trimEnd();
}

export function createConfigTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleConfigRequest(req, res, url.pathname).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

export function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
