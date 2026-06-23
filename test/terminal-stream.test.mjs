/**
 * Terminal streaming API tests (requires `npm start`).
 * Usage: node test/terminal-stream.test.mjs http://localhost:5173
 */

import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHAT_A = '11111111-1111-1111-1111-111111111111';
const CHAT_B = '22222222-2222-2222-2222-222222222222';
const UNKNOWN_RUN = '00000000-0000-0000-0000-000000000000';

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

function parseSseEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* ignore */
    }
  }
  return events;
}

async function readStreamResponse(res) {
  const text = await res.text();
  return parseSseEvents(text);
}

async function testRunReturnsRunId() {
  const res = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'echo MINNOW_STREAM_OK' }),
  });
  const body = await res.json();
  assert(res.status === 200, 'run status 200');
  assert(typeof body.runId === 'string', 'runId is string');
  assert(
    /^[a-f0-9-]{36}$/i.test(body.runId),
    'runId matches UUID format',
  );
  return body.runId;
}

async function testStreamEmitsStdoutAndExit(runId) {
  const res = await fetch(`${BASE}/api/terminal/stream/${runId}`);
  const events = await readStreamResponse(res);
  assert(res.status === 200, 'stream status 200');
  const stdout = events.filter((e) => e.type === 'stdout').map((e) => e.text).join('');
  const exit = events.find((e) => e.type === 'exit');
  assert(stdout.includes('MINNOW_STREAM_OK'), 'stdout contains marker');
  assert(exit && exit.code === 0, 'exit code 0');
}

async function testUnknownRun404() {
  const res = await fetch(`${BASE}/api/terminal/stream/${UNKNOWN_RUN}`);
  assert(res.status === 404, 'unknown run returns 404');
}

async function testInvalidCommand400() {
  const res = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert(res.status === 400, 'missing command returns 400');
  assert(typeof body.error === 'string', 'error message present');
}

async function drainRunStream(runId) {
  const res = await fetch(`${BASE}/api/terminal/stream/${runId}`);
  await res.text();
}

async function readMetaCwdFromRun(body) {
  const res = await fetch(`${BASE}/api/terminal/stream/${body.runId}`);
  const events = await readStreamResponse(res);
  const meta = events.find((e) => e.type === 'meta');
  return meta?.cwd;
}

async function ensureTestChats(worktreeRoot) {
  const getRes = await fetch(`${BASE}/api/config/sessions`);
  const state = getRes.ok ? await getRes.json() : { version: 1, chats: [], activeId: CHAT_A };
  const chats = Array.isArray(state.chats) ? [...state.chats] : [];
  for (const id of [CHAT_A, CHAT_B]) {
    const existing = chats.find((c) => c.id === id);
    if (!existing) {
      chats.push({
        id,
        name: `Test ${id.slice(0, 8)}`,
        modelId: '',
        modeId: 'build',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: Date.now(),
        ...(id === CHAT_A && worktreeRoot ? { worktreeRoot } : {}),
      });
    } else if (id === CHAT_A && worktreeRoot) {
      existing.worktreeRoot = worktreeRoot;
    }
  }
  const putRes = await fetch(`${BASE}/api/config/sessions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...state,
      chats,
    }),
  });
  if (!putRes.ok) {
    throw new Error(`Failed to seed sessions: HTTP ${putRes.status}`);
  }
}

async function testHistoryScopedToChat() {
  await ensureTestChats();

  const runA = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo CHAT_A',
      chatId: CHAT_A,
      source: 'user',
    }),
  });
  const bodyA = await runA.json();
  await drainRunStream(bodyA.runId);

  const runB = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo CHAT_B',
      chatId: CHAT_B,
      source: 'user',
    }),
  });
  const bodyB = await runB.json();
  await drainRunStream(bodyB.runId);

  const histA = await fetch(
    `${BASE}/api/terminal/history?chatId=${encodeURIComponent(CHAT_A)}`,
  );
  const dataA = await histA.json();
  const idsA = (dataA.runs ?? []).map((r) => r.id);
  const idsB = (dataA.runs ?? [])
    .map((r) => r.command)
    .join(' ');

  assert(idsA.includes(bodyA.runId), 'history A includes run A');
  assert(!idsA.includes(bodyB.runId), 'history A excludes run B');
  assert(idsB.includes('CHAT_A'), 'history A command is CHAT_A');
}

async function testUserRunUsesGlobalCwd() {
  const runRes = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo cwd_probe',
      chatId: CHAT_A,
      source: 'user',
    }),
  });
  const body = await runRes.json();
  const cwd = await readMetaCwdFromRun(body);
  await drainRunStream(body.runId);
  assert(typeof cwd === 'string' && cwd.length > 0, 'meta.cwd present for user run');
  return cwd;
}

async function testAgentRunResolvesWorktreeFromChat(projectRoot) {
  const worktreeRoot = projectRoot;
  await ensureTestChats(worktreeRoot);

  const runRes = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo agent_worktree',
      chatId: CHAT_A,
      source: 'agent',
    }),
  });
  const body = await runRes.json();
  const cwd = await readMetaCwdFromRun(body);
  await drainRunStream(body.runId);
  assert(
    path.resolve(cwd) === path.resolve(worktreeRoot),
    'agent run without workspaceRoot uses chat worktreeRoot',
  );
}

async function testAgentExplicitWorkspaceRootAndRelativeCwd(projectRoot) {
  const runRes = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo subdir',
      chatId: CHAT_A,
      source: 'agent',
      workspaceRoot: projectRoot,
      cwd: 'src',
    }),
  });
  const body = await runRes.json();
  const cwd = await readMetaCwdFromRun(body);
  await drainRunStream(body.runId);
  assert(
    path.resolve(cwd) === path.resolve(projectRoot, 'src'),
    'agent run resolves cwd relative to workspaceRoot',
  );
}

async function testInvalidWorkspaceRoot400() {
  const res = await fetch(`${BASE}/api/terminal/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'echo bad_root',
      chatId: CHAT_A,
      source: 'agent',
      workspaceRoot: 'C:/not-an-allowed-minnow-workspace-root',
    }),
  });
  const body = await res.json();
  assert(res.status === 400, 'non-allow-listed workspaceRoot returns 400');
  assert(typeof body.error === 'string', 'error message present');
}

async function main() {
  console.log(`Terminal stream tests @ ${BASE}\n`);

  try {
    const ping = await fetch(`${BASE}/api/tools/ping`);
    if (!ping.ok) {
      console.error('Server not reachable. Start with: npm start');
      process.exit(1);
    }
  } catch {
    console.error('Server not reachable. Start with: npm start');
    process.exit(1);
  }

  console.log('run_returns_runId');
  const runId = await testRunReturnsRunId();

  console.log('\nstream_emits_stdout_and_exit');
  await testStreamEmitsStdoutAndExit(runId);

  console.log('\nunknown_run_404');
  await testUnknownRun404();

  console.log('\ninvalid_command_400');
  await testInvalidCommand400();

  console.log('\nhistory_scoped_to_chat');
  await testHistoryScopedToChat();

  console.log('\nuser_run_uses_global_cwd');
  const projectRoot = await testUserRunUsesGlobalCwd();

  console.log('\nagent_run_resolves_worktree_from_chat');
  await testAgentRunResolvesWorktreeFromChat(projectRoot);

  console.log('\nagent_explicit_workspace_root_and_relative_cwd');
  await testAgentExplicitWorkspaceRootAndRelativeCwd(projectRoot);

  console.log('\ninvalid_workspace_root_400');
  await testInvalidWorkspaceRoot400();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
