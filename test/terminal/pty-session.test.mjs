/**
 * PTY session integration (requires `npm start`).
 * Usage: node test/terminal/pty-session.test.mjs http://localhost:5173
 * Or: npm run test:terminal-pty
 */

const BASE = process.env.TERMINAL_TEST_BASE ?? process.argv[2] ?? '';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  OK ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${message}`);
  }
}

async function main() {
  if (!BASE) {
    console.log('SKIP pty-session.test.mjs (set TERMINAL_TEST_BASE or pass base URL)');
    process.exit(0);
  }

  const profilesRes = await fetch(`${BASE}/api/terminal/shell-profiles`);
  const profilesBody = await profilesRes.json();
  assert(profilesRes.status === 200, 'shell-profiles 200');
  assert(Array.isArray(profilesBody.profiles), 'profiles array');
  assert(profilesBody.ptyAvailable === true, 'pty available');

  const profileId = profilesBody.profiles[0]?.id ?? 'powershell';
  const sessionRes = await fetch(`${BASE}/api/terminal/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shellProfileId: profileId, cols: 80, rows: 24 }),
  });
  const session = await sessionRes.json();
  assert(sessionRes.status === 200, 'create session 200');
  assert(typeof session.sessionId === 'string', 'sessionId');

  const wsUrl = BASE.replace(/^http/, 'ws') + `/api/terminal/ws?sessionId=${encodeURIComponent(session.sessionId)}`;
  const output = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let acc = '';
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, 8000);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'output') acc += msg.data;
        if (acc.includes('MINNOW_PTY_TEST')) {
          clearTimeout(timer);
          ws.close();
          resolve(acc);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'input', data: 'echo MINNOW_PTY_TEST\r\n' }));
    };
    ws.onerror = (e) => reject(e);
  }).catch((err) => {
    console.error(err);
    return '';
  });

  assert(output.includes('MINNOW_PTY_TEST'), 'ws receives echoed text');

  const delRes = await fetch(
    `${BASE}/api/terminal/session/${encodeURIComponent(session.sessionId)}`,
    { method: 'DELETE' },
  );
  assert(delRes.status === 200, 'delete session 200');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
