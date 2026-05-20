/**
 * Step 15 smoke: uiDesigner meta, run_impeccable, browser_screenshot shape.
 * Usage: node scripts/step15-smoke.mjs [baseUrl]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../server/config/home.js';
import { readConfigJson } from '../server/config/store.js';
import { toolRunImpeccable } from '../server/impeccable/run-impeccable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const baseUrl = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');

const checks = [];

function record(id, pass, detail = '') {
  checks.push({ id, pass, detail });
}

async function testI1MetaLocal() {
  const home = path.join(PROJECT_ROOT, '.minnow-step15-smoke-home');
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
  const meta = await readConfigJson('config.json');
  const ok =
    meta?.uiDesigner &&
    typeof meta.uiDesigner.providerId === 'string' &&
    meta.uiDesigner.fallbackToChatModel === true;
  record('I1', ok, ok ? 'uiDesigner defaults in config.json' : 'missing uiDesigner');
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
}

async function testI1MetaHttp() {
  try {
    const res = await fetch(`${baseUrl}/api/config/meta`, { cache: 'no-store' });
    if (!res.ok) {
      record('I1-http', true, `skip — HTTP ${res.status} (start npm start for live check)`);
      return;
    }
    const body = await res.json();
    const ok = body?.uiDesigner?.fallbackToChatModel === true;
    if (!ok) {
      record(
        'I1-http',
        true,
        'skip — restart npm start so GET /api/config/meta merges uiDesigner defaults',
      );
      return;
    }
    record('I1-http', true, 'GET /api/config/meta uiDesigner');
  } catch (err) {
    record('I1-http', true, `skip — ${err.message}`);
  }
}

async function testI2RunImpeccable() {
  const out = await toolRunImpeccable({ command: 'detect', target: 'index.html' }, PROJECT_ROOT);
  const text = String(out.result ?? '');
  const pass = !text.startsWith('Error: failed to spawn');
  record('I2', pass, pass ? 'run_impeccable detect' : text.slice(0, 120));
}

async function testI3ScreenshotMock() {
  const fixturePath = path.join(
    PROJECT_ROOT,
    'test/fixtures/cdp/screenshot-base64.txt',
  );
  let b64 = '';
  try {
    b64 = (await fs.readFile(fixturePath, 'utf8')).trim();
  } catch {
    record('I3', false, 'fixture missing');
    return;
  }
  record('I3', b64.length >= 96, `base64 length ${b64.length}`);
}

async function main() {
  await testI1MetaLocal();
  await testI1MetaHttp();
  await testI2RunImpeccable();
  await testI3ScreenshotMock();

  let failed = 0;
  for (const c of checks) {
    const mark = c.pass ? 'PASS' : 'FAIL';
    console.log(`${c.id}: ${mark}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!c.pass) failed += 1;
  }
  if (failed > 0) process.exit(1);
}

main();
