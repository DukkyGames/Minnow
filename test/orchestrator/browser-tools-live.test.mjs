/**
 * P5-B — Browser driver tools against a real browser (MIN-720).
 *
 * Every call here goes through `executeInProcessTool` — P2-D's dispatch, the
 * same one a Builder's `grep` takes — into a real Chromium driving a real
 * fixture server. On a machine with no browser these **skip**, the same
 * degradation the Final Tester ladder does.
 *
 * Nothing asserts on a screenshot. The reads are the assertion mechanism; the
 * screenshot test asserts only that a file appeared, because P5-A's hazard note
 * is that those round-trips hang and a hung one must not be able to fail a run.
 *
 * The unit counterpart is `browser-tools.test.mjs`.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { resetBrowserConfigCache } from '../../server/cdp/browser-config.js';
import { discoverBrowser } from '../../server/browser-driver/index.js';
import { executeInProcessTool } from '../../server/runner/node.js';
import { DEFAULT_MAX_OUTPUT_CHARS } from '../../server/tools/output-cap.js';
import { FINAL_TESTER_TOOL_IDS } from '../../server/runner/tool-set.js';
import {
  BROWSER_BLOCKED_PREFIX,
  browserToolSessionKeys,
  closeAllBrowserToolSessions,
} from '../../server/tools/browser-driver-tools.js';

const PAGE_HTML = `<!doctype html>
<html><head><title>Tester Fixture</title><link rel="icon" href="data:,"></head>
<body>
  <h1>tester fixture</h1>
  <p id="status">status: idle</p>
  <button id="run" aria-label="Run tests">Run tests</button>
  <input id="name" aria-label="Name field" value="">
  <p id="typed">typed: (none)</p>
  <p id="size">width: 0</p>
  <p id="data">data: pending</p>
  <script>
    console.error('fixture console error');
    document.getElementById('run').addEventListener('click', function () {
      document.getElementById('status').textContent = 'status: clicked';
    });
    var input = document.getElementById('name');
    input.addEventListener('input', function () {
      document.getElementById('typed').textContent = 'typed: ' + input.value;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('status').textContent = 'status: submitted';
    });
    function paintSize() {
      document.getElementById('size').textContent = 'width: ' + window.innerWidth;
    }
    paintSize();
    window.addEventListener('resize', paintSize);
    fetch('/api/missing').then(function () {
      return fetch('/api/data.json');
    }).then(function (r) { return r.json(); }).then(function (j) {
      document.getElementById('data').textContent = 'data: ' + j.value;
    });
  </script>
</body></html>`;

/**
 * A page whose DOM comfortably exceeds the shared output cap.
 *
 * Sized from `DEFAULT_MAX_OUTPUT_CHARS` rather than a literal: MIN-667 made the
 * cap configurable and raised the default from 32k to 128k, which silently made
 * a fixed-size fixture too small to truncate at all.
 */
const BIG_PARAGRAPH_COUNT = Math.ceil((DEFAULT_MAX_OUTPUT_CHARS * 2) / 190);
const BIG_HTML = `<!doctype html>
<html><head><title>Big</title><link rel="icon" href="data:,"></head><body>
${Array.from({ length: BIG_PARAGRAPH_COUNT }, (_, i) => `<p id="p${i}">paragraph ${i} ${'z'.repeat(160)}</p>`).join('\n')}
</body></html>`;

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = String(req.url ?? '/');
    if (url.startsWith('/api/data.json')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ value: 'ok' }));
      return;
    }
    if (url.startsWith('/api/missing')) {
      res.statusCode = 404;
      res.end('nope');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(url.startsWith('/big') ? BIG_HTML : PAGE_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

// Module scope, not `before`: node:test evaluates a suite's `skip` when the
// suite is *defined*, which is earlier than any hook.
const previousHome = process.env.MINNOW_HOME;
const homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mn-btools-live-'));
process.env.MINNOW_HOME = homeDir;
resetMinnowHomeCache();
resetBrowserConfigCache();
const cwd = path.join(homeDir, 'chats');
await fsp.mkdir(cwd, { recursive: true });

const capability = await discoverBrowser();
/** @type {string | false} */
const skipReason = capability.available
  ? false
  : `no Chromium-family browser on this machine (${capability.reason})`;
const fixture = capability.available ? await startFixtureServer() : null;

after(async () => {
  await closeAllBrowserToolSessions();
  fixture?.server.close();
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetBrowserConfigCache();
  await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/**
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
async function callTool(name, args = {}) {
  const result = await executeInProcessTool(name, args, {
    cwd,
    allowedToolNames: [...FINAL_TESTER_TOOL_IDS],
  });
  return result.content;
}

/**
 * Poll a text read until it contains `needle`. The fixture loads data
 * asynchronously and a determinism assertion taken mid-flight would be
 * measuring the fetch, not the reader.
 * @param {string} needle
 * @param {number} [timeoutMs]
 */
async function waitForText(needle, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await callTool('browser_drive_read_page', { mode: 'text' });
    if (text.includes(needle)) return text;
    if (Date.now() >= deadline) {
      assert.fail(`timed out waiting for ${JSON.stringify(needle)}; last read:\n${text}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * First uid whose rendered line matches. The a11y tree is the addressing
 * surface, so this is also how a Final Tester finds what to click.
 * @param {string} tree
 * @param {RegExp} pattern
 * @returns {number}
 */
function uidMatching(tree, pattern) {
  for (const line of tree.split('\n')) {
    if (!pattern.test(line)) continue;
    const uid = line.match(/\[(\d+)\]/)?.[1];
    if (uid) return Number(uid);
  }
  assert.fail(`no line matched ${pattern} in:\n${tree}`);
}

describe('browser tools — live, through the real dispatch', { skip: skipReason }, () => {
  test('navigate launches a browser and reports the load', async () => {
    const content = await callTool('browser_drive_navigate', { url: `${fixture.origin}/` });
    assert.match(content, /outcome: loaded/);
    assert.match(content, /title: Tester Fixture/);
    assert.deepEqual(browserToolSessionKeys(), [path.resolve(cwd)]);
  });

  test('the accessibility read is the assertion surface', async () => {
    await waitForText('data: ok');
    const tree = await callTool('browser_drive_read_page', { mode: 'a11y' });
    assert.match(tree, /button "Run tests"/, tree);
    assert.match(tree, /heading "tester fixture"/, tree);
  });

  test('repeated reads of a static page are byte-identical in every mode', async () => {
    await waitForText('data: ok');
    for (const mode of ['a11y', 'text', 'dom']) {
      const first = await callTool('browser_drive_read_page', { mode });
      const second = await callTool('browser_drive_read_page', { mode });
      const third = await callTool('browser_drive_read_page', { mode });
      assert.equal(first, second, `mode ${mode} drifted between reads 1 and 2`);
      assert.equal(second, third, `mode ${mode} drifted between reads 2 and 3`);
    }
  });

  test('read_console carries the page error and is stable across reads', async () => {
    const first = await callTool('browser_drive_read_console', { level: 'error' });
    assert.match(first, /fixture console error/, first);
    const second = await callTool('browser_drive_read_console', { level: 'error' });
    assert.equal(first, second, 'a settled page must give the same console twice');
  });

  test('read_network is sorted, stable, and surfaces the 404', async () => {
    const first = await callTool('browser_drive_read_network', {});
    assert.match(first, /GET 200 .*\/api\/data\.json/, first);
    assert.match(first, /GET 404 .*\/api\/missing/, first);
    const second = await callTool('browser_drive_read_network', {});
    assert.equal(first, second, 'a settled page must give the same network twice');

    // Sorted by url, not by when the response landed.
    const urls = first
      .split('\n')
      .filter((line) => /^(GET|POST) /.test(line))
      .map((line) => line.split(' ').slice(2).join(' '));
    assert.deepEqual(urls, [...urls].sort(), `network output was not url-sorted:\n${first}`);

    const failed = await callTool('browser_drive_read_network', { failed_only: true });
    assert.match(failed, /\/api\/missing/);
    assert.equal(/\/api\/data\.json/.test(failed), false, failed);
  });

  test('click acts on a uid from the current snapshot and invalidates it', async () => {
    const tree = await callTool('browser_drive_read_page', { mode: 'a11y' });
    const uid = uidMatching(tree, /button "Run tests"/);

    const clicked = await callTool('browser_drive_click', { uid });
    assert.match(clicked, /clicked \[\d+\] button "Run tests"/, clicked);
    assert.match(clicked, /snapshot is now stale/);

    const text = await callTool('browser_drive_read_page', { mode: 'text' });
    assert.match(text, /status: clicked/, text);

    // The uid was invalidated by the click, so reusing it is refused rather
    // than silently acting on a page that has moved on.
    const stale = await callTool('browser_drive_click', { uid });
    assert.match(stale, /^Error: no current page snapshot/);
  });

  test('type goes through the real input pipeline, and submit presses Enter', async () => {
    const tree = await callTool('browser_drive_read_page', { mode: 'a11y' });
    const uid = uidMatching(tree, /"Name field"/);

    const typed = await callTool('browser_drive_type', { uid, text: 'minnow' });
    assert.match(typed, /typed 6 chars/, typed);
    // The `input` event fired — an assignment to `.value` would not have.
    assert.match(await callTool('browser_drive_read_page', { mode: 'text' }), /typed: minnow/);

    const fresh = await callTool('browser_drive_read_page', { mode: 'a11y' });
    const uid2 = uidMatching(fresh, /"Name field"/);
    await callTool('browser_drive_type', { uid: uid2, text: 'again', submit: true });
    const text = await callTool('browser_drive_read_page', { mode: 'text' });
    assert.match(text, /typed: again/, text);
    assert.match(text, /status: submitted/, text);
  });

  test('resize changes the real viewport', async () => {
    const content = await callTool('browser_drive_resize', { width: 420, height: 900 });
    assert.match(content, /viewport: 420x900/);
    const text = await callTool('browser_drive_read_page', { mode: 'text' });
    assert.match(text, /width: 420/, text);
    await callTool('browser_drive_resize', { width: 1280, height: 800 });
  });

  test('a large DOM read is truncated and says so', async () => {
    await callTool('browser_drive_navigate', { url: `${fixture.origin}/big` });
    const content = await callTool('browser_drive_read_page', { mode: 'dom' });
    assert.match(content, /\[truncated — \d+ of \d+ chars;/, content.slice(0, 400));
    // Cap plus the fence and truncation footer — not a fixed byte count.
    assert.ok(
      content.length < DEFAULT_MAX_OUTPUT_CHARS * 1.05,
      `capped read was ${content.length} chars`,
    );
    assert.match(content, /UNTRUSTED_SOURCE_DATA/, 'page text must be fenced as untrusted');
  });

  test('the allowlist blocks a disallowed origin, with no browser exception', async () => {
    const content = await callTool('browser_drive_navigate', { url: 'https://example.com/' });
    assert.ok(content.startsWith(BROWSER_BLOCKED_PREFIX), content);
    assert.match(content, /no interactive approval/);
    // The live session is untouched: a refusal is not a teardown.
    const text = await callTool('browser_drive_read_page', { mode: 'text' });
    assert.match(text, /paragraph 0/, text);
  });

  test('screenshot is evidence: a file appears, and nothing asserts on it', async () => {
    const content = await callTool('browser_drive_screenshot', {});
    assert.match(content, /Evidence for the report only/);
    const filePath = content.match(/^path: (.+)$/m)?.[1];
    if (!filePath) {
      // A capture failure is reported, never thrown, and never fails a run.
      assert.match(content, /screenshot: not captured/);
      return;
    }
    const stat = await fsp.stat(filePath.trim());
    assert.ok(stat.size > 0, 'the screenshot file should have bytes');
  });

  test('a hung page fails one navigate call and leaves the session usable', async () => {
    const content = await callTool('browser_drive_navigate', {
      url: `${fixture.origin}/`,
      timeout_ms: 1,
    });
    // Either the load beat the 1ms deadline or the deadline fired; both are one
    // tool-call outcome, and neither may reject upward.
    assert.ok(
      /timed out after 1ms/.test(content) || /outcome: (loaded|timeout)/.test(content),
      content,
    );
    const recovered = await callTool('browser_drive_navigate', { url: `${fixture.origin}/` });
    assert.match(recovered, /outcome: loaded/, recovered);
  });

  test('closing the tool session kills the browser and leaves no orphan', async () => {
    const before = browserToolSessionKeys();
    assert.deepEqual(before, [path.resolve(cwd)]);
    await closeAllBrowserToolSessions();
    assert.deepEqual(browserToolSessionKeys(), []);

    // And the tools say so rather than hanging on a dead socket.
    const content = await callTool('browser_drive_read_page', { mode: 'text' });
    assert.match(content, /no browser is open/);
  });
});
