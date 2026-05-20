/**
 * CDP browser tool integration tests (mock server — no real Chrome).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startMockCdpServer } from './helpers/mock-cdp-server.mjs';
import {
  resetMinnowHomeCache,
  getMinnowHome,
} from '../server/config/home.js';
import { resetBrowserConfigCache } from '../server/cdp/browser-config.js';
import { clearSnapshotCache } from '../server/cdp/snapshot-cache.js';
import {
  toolBrowserList,
  toolBrowserNavigate,
  toolBrowserSnapshot,
  toolBrowserClick,
  toolBrowserScreenshot,
} from '../server/cdp/browser-tools.js';

let mock;
let tempHome;

before(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-cdp-test-'));
  process.env.MINNOW_HOME = tempHome;
  resetMinnowHomeCache();
  resetBrowserConfigCache();
  clearSnapshotCache();

  await fs.mkdir(path.join(tempHome, 'screenshots'), { recursive: true });
  await fs.writeFile(
    path.join(tempHome, 'config.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        browser: {
          enabled: true,
          defaultUrl: 'http://127.0.0.1:9222',
          allowNavigate: true,
          allowedOriginPatterns: [
            'http://localhost:*',
            'http://127.0.0.1:*',
          ],
          screenshotDir: 'screenshots',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  mock = await startMockCdpServer();
  process.env.MINNOW_BROWSER_URL = mock.baseUrl;
  resetBrowserConfigCache();
});

after(async () => {
  if (mock) await mock.close();
  delete process.env.MINNOW_BROWSER_URL;
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  resetBrowserConfigCache();
});

test('browser_list returns target ids and titles', async () => {
  const result = await toolBrowserList({});
  assert.match(result, /TEST-TARGET-11111111/);
  assert.match(result, /Test Page/);
});

test('browser_navigate blocked URL returns Error prefix', async () => {
  const result = await toolBrowserNavigate({
    browser_url: mock.baseUrl,
    url: 'https://evil.example/',
  });
  assert.match(String(result), /^Error: navigation blocked/);
});

test('browser_click without snapshot returns cache miss', async () => {
  clearSnapshotCache();
  const result = await toolBrowserClick({
    browser_url: mock.baseUrl,
    uid: 2,
  });
  assert.match(result, /No snapshot cached/);
});

test('browser_snapshot then click succeeds', async () => {
  clearSnapshotCache();
  const snap = await toolBrowserSnapshot({ browser_url: mock.baseUrl });
  assert.match(snap, /\[2\]/);
  const click = await toolBrowserClick({
    browser_url: mock.baseUrl,
    uid: 2,
  });
  assert.match(click, /Clicked/);
});

test('browser_screenshot writes file and returns attachments shape', async () => {
  const out = await toolBrowserScreenshot({
    browser_url: mock.baseUrl,
    _testScreenshotId: 'testshot12',
  });
  assert.ok(out.result.includes('Screenshot saved'));
  assert.equal(out.attachments?.[0]?.type, 'image');
  assert.match(out.attachments[0].url, /^\/api\/browser\/screenshot\/testshot12/);

  const filePath = path.join(getMinnowHome(), 'screenshots', 'testshot12.png');
  const stat = await fs.stat(filePath);
  assert.ok(stat.size > 0);
});

test('default browser_url from MINNOW_BROWSER_URL', async () => {
  const result = await toolBrowserList({});
  assert.match(result, /TEST-TARGET-11111111/);
});
