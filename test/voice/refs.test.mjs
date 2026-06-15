/**
 * Voice reference audio upload and clone-prompt listing APIs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { request as httpRequestNode } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { getVoiceRefsDir } from '../../server/voice/paths.js';
import { handleVoiceRequest } from '../../server/voice/routes.js';

function httpRequest(baseUrl, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body;
    const r = httpRequestNode(
      url,
      {
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json = null;
          try {
            json = raw.length ? JSON.parse(raw.toString('utf8')) : null;
          } catch {
            json = { raw: raw.toString('utf8') };
          }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function buildMultipartBody(filename, mime, data) {
  const boundary = 'minnow-voice-ref-test';
  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  return {
    boundary,
    body: Buffer.concat([Buffer.from(header), data, Buffer.from(footer)]),
  };
}

async function startVoiceApiServer(homeDir) {
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const handled = await handleVoiceRequest(req, res, pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('voice refs API', () => {
  /** @type {import('node:http').Server | null} */
  let server = null;
  let baseUrl = '';
  let homeDir = '';

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-voice-refs-'));
    const started = await startVoiceApiServer(homeDir);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });

  test('POST /api/voice/refs/upload saves audio under ~/.minnow/voice/refs/', async () => {
    const audio = Buffer.from('fake-wav-bytes');
    const { boundary, body } = buildMultipartBody('sample.wav', 'audio/wav', audio);
    const res = await httpRequest(baseUrl, 'POST', '/api/voice/refs/upload', body, {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(typeof res.json.ref?.id === 'string');
    assert.ok(typeof res.json.ref?.filename === 'string');
    const refsDir = getVoiceRefsDir();
    const files = await fs.readdir(refsDir);
    assert.ok(files.some((name) => name.endsWith('.wav')));
  });

  test('GET /api/voice/clone-prompts returns prompt list', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/voice/clone-prompts');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.prompts));
  });
});
