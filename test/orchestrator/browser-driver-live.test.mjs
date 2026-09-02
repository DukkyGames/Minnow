
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { resetBrowserConfigCache } from '../../server/cdp/browser-config.js';
import {
  BrowserDriverError,
  discoverBrowser,
  isPidAlive,
  launchBrowser,
  trackedBrowserPids,
} from '../../server/browser-driver/index.js';

const PAGE_HTML = `<!doctype html>
<html><head><title>Driver Fixture</title></head>
<body>
  <h1>driver fixture</h1>
  <button aria-label="Run tests">Run tests</button>
  <p id="marker">ready</p>
  <script>
    console.error('fixture console error');
    try { localStorage.setItem('mn-driver', 'seen'); } catch (e) {}
    document.cookie = 'mn-driver=seen; path=/';
  </script>
</body></html>`;

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = String(req.url ?? '/');
    if (url.startsWith('/hang')) return;
    if (url.startsWith('/probe')) {
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><title>Probe</title><body><pre id="out"></pre><script>
          const ls = (() => { try { return localStorage.getItem('mn-driver'); } catch (e) { return 'ERR'; } })();
          document.getElementById('out').textContent =
            'ls=' + String(ls) + ' cookie=' + (document.cookie || '(none)');
        </script></body>`,
      );
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(PAGE_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function killExternally(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
    }
  }
}

function waitUntil(predicate, timeoutMs = 10_000, stepMs = 50) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

async function waitForGone(target, timeoutMs = 15_000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fsp.access(target);
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const previousHome = process.env.MINNOW_HOME;
const homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mn-driver-live-'));
process.env.MINNOW_HOME = homeDir;
resetMinnowHomeCache();
resetBrowserConfigCache();

const capability = await discoverBrowser();
/** @type {string | false} */
const skipReason = capability.available
  ? false
  : `no Chromium-family browser on this machine (${capability.reason})`;
const fixture = capability.available ? await startFixtureServer() : null;

after(async () => {
  fixture?.server.close();
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetBrowserConfigCache();
  await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** @param {import('../../server/browser-driver/index.js').LaunchOptions} [opts] */
async function launchOrFail(opts = {}) {
  const launched = await launchBrowser({ label: 'test', hardTimeoutMs: 90_000, ...opts });
  assert.equal(launched.ok, true, `launch failed: ${launched.ok ? '' : launched.detail}`);
  return launched.session;
}

describe('browser driver — live', { skip: skipReason }, () => {
  test('launch, navigate, read the DOM, shut down cleanly', async () => {
    const session = await launchOrFail();
    const profileDir = session.status().profileDir;
    const pid = session.status().pid;

    try {
      assert.ok(pid > 0);
      assert.ok(isPidAlive(pid), 'the browser process should be running');
      assert.match(session.status().browserVersion, /\//, 'expected a browser version string');
      assert.ok(
        trackedBrowserPids().includes(pid),
        'a live browser must be registered for the host-exit drain',
      );

      const nav = await session.navigate(`${fixture.origin}/`);
      assert.equal(nav.outcome, 'loaded');
      assert.equal(nav.title, 'Driver Fixture');

      const text = await session.text();
      assert.match(text, /driver fixture/);

      const html = await session.html();
      assert.match(html, /id="marker"/);

      const snap = await session.snapshot();
      assert.match(snap.text, /button "Run tests"/, `snapshot was:\n${snap.text}`);
      assert.ok(snap.byUid.size > 1, 'the snapshot must address more than the root');

      const value = await session.evaluate('document.getElementById("marker").textContent');
      assert.equal(value, 'ready');

      await waitUntil(() => session.consoleMessages().some((m) => m.text.includes('fixture console error')));
      const errors = session.consoleMessages().filter((m) => m.level === 'error');
      assert.ok(
        errors.some((m) => m.text.includes('fixture console error')),
        `expected the page console error, got ${JSON.stringify(session.consoleMessages())}`,
      );
    } finally {
      await session.close();
    }

    assert.equal(session.status().alive, false);
    assert.equal(session.status().endedReason, 'user');
    assert.ok(await waitUntil(() => !isPidAlive(pid)), 'the browser process should be gone');
    assert.ok(await waitForGone(profileDir), 'the profile directory should be removed');
    assert.equal(trackedBrowserPids().includes(pid), false, 'no orphan should stay registered');
  });

  test('a browser killed out from under the driver is reported, and the caller survives', async () => {
    const session = await launchOrFail();
    const pid = session.status().pid;
    const profileDir = session.status().profileDir;
    await session.navigate(`${fixture.origin}/`);

    killExternally(pid);

    assert.ok(
      await waitUntil(() => session.status().alive === false),
      'the driver should notice the browser died',
    );
    const status = session.status();
    assert.equal(status.endedReason, 'external');
    assert.match(String(status.endedDetail), /exited unexpectedly/);

    const startedAt = Date.now();
    await assert.rejects(
      () => session.text(),
      (err) => err instanceof BrowserDriverError && err.code === 'gone',
    );
    assert.ok(Date.now() - startedAt < 2_000, 'a dead session must reject immediately');

    await session.close();
    assert.ok(await waitForGone(profileDir), 'close() must tear down the profile of a dead browser');

    const next = await launchOrFail();
    try {
      const nav = await next.navigate(`${fixture.origin}/`);
      assert.equal(nav.outcome, 'loaded');
    } finally {
      await next.close();
    }
  });

  test('a page that hangs on load hits the navigation timeout without wedging the driver', async () => {
    const session = await launchOrFail();
    try {
      const startedAt = Date.now();
      const nav = await session.navigate(`${fixture.origin}/hang`, { timeoutMs: 2_000 });
      const elapsed = Date.now() - startedAt;

      assert.equal(nav.outcome, 'timeout');
      assert.ok(elapsed < 15_000, `navigate should return near its deadline, took ${elapsed}ms`);

      assert.equal(session.status().alive, true);
      assert.equal(await session.isResponsive(), true);
      assert.equal(await session.evaluate('1 + 1'), 2);
    } finally {
      await session.close();
    }
  });

  test('the hard timeout kills a session that outlives its budget', async () => {
    const session = await launchOrFail({ hardTimeoutMs: 1_500 });
    const pid = session.status().pid;
    const profileDir = session.status().profileDir;

    assert.ok(
      await waitUntil(() => session.status().alive === false, 20_000),
      'hardTimeoutMs should have ended the session',
    );
    assert.ok(
      ['hard-timeout', 'external'].includes(String(session.status().endedReason)),
      `unexpected end reason: ${session.status().endedReason}`,
    );
    assert.ok(await waitUntil(() => !isPidAlive(pid)), 'the browser must be killed on the hard timeout');
    assert.ok(await waitForGone(profileDir), 'the profile must be torn down');
  });

  test('navigation outside the allowlist is refused', async () => {
    const session = await launchOrFail({ allowedOriginPatterns: ['http://127.0.0.1:*'] });
    try {
      await assert.rejects(
        () => session.navigate('https://example.com/'),
        (err) => err instanceof BrowserDriverError && err.code === 'allowlist',
      );
      assert.equal(session.status().alive, true);
      const nav = await session.navigate(`${fixture.origin}/`);
      assert.equal(nav.outcome, 'loaded');
    } finally {
      await session.close();
    }
  });

  test('two sequential runs share no cookies or storage', async () => {
    const first = await launchOrFail();
    let firstProfile;
    try {
      firstProfile = first.status().profileDir;
      const nav = await first.navigate(`${fixture.origin}/`);
      assert.equal(nav.outcome, 'loaded');
      assert.equal(await first.evaluate('localStorage.getItem("mn-driver")'), 'seen');
      assert.match(String(await first.evaluate('document.cookie')), /mn-driver=seen/);
    } finally {
      await first.close();
    }

    const second = await launchOrFail();
    try {
      assert.notEqual(second.status().profileDir, firstProfile, 'each run gets its own profile');
      const nav = await second.navigate(`${fixture.origin}/probe`);
      assert.equal(nav.outcome, 'loaded');
      const readback = await second.text();
      assert.match(readback, /ls=null/, `localStorage leaked across runs: ${readback}`);
      assert.match(readback, /cookie=\(none\)/, `cookies leaked across runs: ${readback}`);
    } finally {
      await second.close();
    }
  });
});
