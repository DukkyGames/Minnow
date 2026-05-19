/**
 * Step 01 UI smoke: static checks against index.html and messages.css.
 * Usage: node scripts/step01-ui-smoke.mjs http://localhost:5173
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] || 'http://localhost:5173';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const checks = [];

function record(id, pass, detail = '') {
  checks.push({ id, pass, detail });
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

try {
  const indexHtml = await fetchText(`${baseUrl}/index.html`);
  record('S1', !indexHtml.includes('id="btnNewChatTop"'), 'btnNewChatTop absent');
  record('S2', indexHtml.includes('id="btnSidebarToggle"'), 'btnSidebarToggle present');
  record(
    'S3',
    indexHtml.includes('topbar-sidebar-toggle') &&
      indexHtml.includes('id="btnSidebarToggle"'),
    'topbar-sidebar-toggle class on hamburger',
  );

  const messagesCss = readFileSync(join(root, 'src/styles/messages.css'), 'utf8');
  record('S4', messagesCss.includes('.stream-status'), 'messages.css has .stream-status');

  const allPass = checks.every((c) => c.pass);
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}${c.detail ? `: ${c.detail}` : ''}`);
  }
  if (!allPass) {
    process.exit(1);
  }
  console.log('step01-ui-smoke: all checks passed');
} catch (err) {
  console.error('step01-ui-smoke failed:', err.message);
  process.exit(1);
}
