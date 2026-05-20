import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  createConfigTestServer,
  httpRequest,
  readFixture,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

async function readJsonFile(homeDir, rel) {
  const raw = await fs.readFile(path.join(homeDir, rel), 'utf8');
  return JSON.parse(raw);
}

describe('config migration', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-migrate');
    server = createConfigTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  test('POST migrate writes static expected files', async () => {
    const body = {
      localStorage: {
        sessions: await readFixture('localStorage-sessions.json'),
        tools: await readFixture('localStorage-tools.json'),
        systemPrompt: await readFixture('localStorage-system-prompt.json'),
      },
    };

    const res = await httpRequest(baseUrl, 'POST', '/api/config/migrate', body);
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.skipped, false);

    const expectedSessions = JSON.parse(await readFixture('expected-sessions-state.json'));
    const expectedTools = JSON.parse(await readFixture('expected-tools.json'));
    const expectedPrompt = JSON.parse(await readFixture('expected-system-prompt.json'));

    assert.deepEqual(await readJsonFile(homeDir, 'sessions/state.json'), expectedSessions);
    assert.deepEqual(await readJsonFile(homeDir, 'tools.json'), expectedTools);
    assert.deepEqual(await readJsonFile(homeDir, 'system-prompt.json'), expectedPrompt);

    const meta = await readJsonFile(homeDir, 'config.json');
    assert.equal(meta.migratedFromLocalStorage, true);
    assert.ok(meta.migratedAt);
  });

  test('POST migrate again is idempotent skipped', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/config/migrate', {
      localStorage: {
        sessions: await readFixture('localStorage-sessions.json'),
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.skipped, true);

    const sessions = await readJsonFile(homeDir, 'sessions/state.json');
    assert.equal(sessions.chats[0].name, 'Fixture chat');
  });

  test('corrupt tools string still migrates sessions with warning', async () => {
    const freshHome = setTestHome(process.env, 'minnow-test-migrate-partial');
    const partialServer = createConfigTestServer();
    await new Promise((resolve) => partialServer.listen(0, '127.0.0.1', resolve));
    const partialUrl = `http://127.0.0.1:${partialServer.address().port}`;

    try {
      const res = await httpRequest(partialUrl, 'POST', '/api/config/migrate', {
        localStorage: {
          sessions: await readFixture('localStorage-sessions.json'),
          tools: '{not valid json',
        },
      });

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.warnings));
      assert.ok(res.json.warnings.some((w) => w.startsWith('tools:')));

      const sessions = await readJsonFile(freshHome, 'sessions/state.json');
      assert.equal(sessions.activeId, '11111111-1111-1111-1111-111111111111');
    } finally {
      await new Promise((resolve) => partialServer.close(resolve));
      await rmTestHome(freshHome);
    }
  });
});
