/**
 * Step 11 smoke: list_directory, read_file, read_file_range via POST /api/tools.
 * Usage: node scripts/step-11-smoke.mjs http://localhost:5173
 */
import assert from 'node:assert/strict';

const baseUrl = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');

async function postTool(name, args) {
  const res = await fetch(`${baseUrl}/api/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

const checks = [];

function record(id, pass, detail = '') {
  checks.push({ id, pass, detail });
}

try {
  const ping = await fetch(`${baseUrl}/api/tools/ping`);
  record('P0', ping.ok, `tools ping HTTP ${ping.status}`);

  const list = await postTool('list_directory', { path: '.' });
  record(
    'P1',
    list.status === 200 && list.body.result.includes('[file] package.json'),
    'root lists package.json',
  );

  const read = await postTool('read_file', { path: 'package.json' });
  record(
    'P2',
    read.status === 200 && read.body.result.includes('"name": "minnow"'),
    'read_file package.json',
  );

  const range = await postTool('read_file_range', {
    path: 'package.json',
    start_line: 1,
    end_line: 3,
  });
  record('P3', range.status === 200 && /^1: /.test(range.body.result), 'read_file_range lines');

  const indexHtml = await fetch(`${baseUrl}/index.html`);
  const html = await indexHtml.text();
  record('P4', html.includes('id="fileSidebar"'), 'file sidebar markup');
  record('P5', html.includes('id="fileViewerPane"'), 'file viewer pane markup');
  record('P6', html.includes('id="btnFileTreeToggle"'), 'files topbar toggle');

  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}${c.detail ? `: ${c.detail}` : ''}`);
  }

  if (!checks.every((c) => c.pass)) {
    process.exit(1);
  }
  console.log('step-11-smoke: all checks passed');
} catch (err) {
  console.error('step-11-smoke failed:', err.message);
  process.exit(1);
}
