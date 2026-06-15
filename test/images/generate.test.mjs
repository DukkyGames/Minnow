/**
 * Image generation proxy — mock provider b64_json responses.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { generateImages } from '../../server/images/providers.js';

const PROVIDER_ID = 'test-openai';
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** @type {string} */
let homeDir;

/** @type {import('node:test').Mock<typeof fetch>} */
let fetchMock;

async function seedProvider(home) {
  const dir = path.join(home, 'providers', PROVIDER_ID);
  await fs.mkdir(dir, { recursive: true });
  const now = '2026-01-01T00:00:00.000Z';
  await fs.writeFile(
    path.join(dir, 'profile.json'),
    JSON.stringify({
      id: PROVIDER_ID,
      label: 'Test OpenAI',
      baseUrl: 'https://api.example.com',
      apiKind: 'openai-v1',
      enabled: true,
      authStyle: 'bearer',
      createdAt: now,
      updatedAt: now,
    }),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'secrets.json'),
    JSON.stringify({ apiKey: 'sk-test', bearerToken: '', headerOverrides: {} }),
    'utf8',
  );
  await fs.writeFile(
    path.join(home, 'config.json'),
    JSON.stringify({
      schemaVersion: 1,
      images: {
        defaultProviderId: PROVIDER_ID,
        defaultModel: 'dall-e-3',
        defaultSize: '1024x1024',
      },
    }),
    'utf8',
  );
}

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-gallery-gen-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await seedProvider(homeDir);

  fetchMock = mock.method(globalThis, 'fetch', async () => {
    return new Response(
      JSON.stringify({
        data: [{ b64_json: PNG_B64 }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
});

after(async () => {
  fetchMock.mock.restore();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('generateImages', () => {
  test('posts to OpenAI-compatible endpoint and decodes b64_json', async () => {
    const results = await generateImages({ prompt: 'A blue square' });

    assert.equal(results.length, 1);
    assert.equal(results[0].providerId, PROVIDER_ID);
    assert.equal(results[0].model, 'dall-e-3');
    assert.ok(Buffer.isBuffer(results[0].bytes));
    assert.ok(results[0].bytes.length > 0);

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'https://api.example.com/v1/images/generations');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.prompt, 'A blue square');
    assert.equal(body.model, 'dall-e-3');
  });

  test('requires prompt', async () => {
    await assert.rejects(() => generateImages({ prompt: '' }), /prompt is required/);
  });
});
