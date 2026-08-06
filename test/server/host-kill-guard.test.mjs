import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MINNOW_DEFAULT_PORT } from '../../server/constants/minnow-port.js';
import { assessHostKillCommand } from '../../server/tools/host-kill-guard.js';

const port = String(MINNOW_DEFAULT_PORT);

// The scheduler base URL defaults to the live Minnow port, so the guard treats it in tests.

test('blocks image-name kills of the Minnow host', () => {
  for (const cmd of [
    'taskkill /F /IM electron.exe /T',
    'taskkill /F /IM Minnow.exe /T',
    'pkill -f electron',
    'killall Minnow',
    'Stop-Process -Name electron -Force',
  ]) {
    const result = assessHostKillCommand(cmd);
    assert.ok(result, `expected block for: ${cmd}`);
    assert.match(result, /running Minnow app/);
  }
});

test('blocks freeing the live dev port via common tools', () => {
  for (const cmd of [
    `Get-NetTCPConnection -LocalPort ${port} | Stop-Process -Id { $_.OwningProcess }`,
    `lsof -ti:${port} | xargs kill -9`,
    `fuser -k ${port}/tcp`,
    `kill $(lsof -ti:${port})`,
  ]) {
    const result = assessHostKillCommand(cmd);
    assert.ok(result, `expected block for: ${cmd}`);
  }
});

test('blocks killing the host node PID', () => {
  const result = assessHostKillCommand(`taskkill /F /PID ${process.pid}`);
  assert.ok(result);
});

// Windows runners often assign 8-digit PIDs; the guard must not truncate them.
test('blocks killing an 8-digit host PID form', () => {
  const longPid = '12345678';
  const originalPid = process.pid;
  Object.defineProperty(process, 'pid', { value: Number(longPid), configurable: true });
  try {
    const result = assessHostKillCommand(`taskkill /F /PID ${longPid}`);
    assert.ok(result, 'expected block for 8-digit host PID');
  } finally {
    Object.defineProperty(process, 'pid', { value: originalPid, configurable: true });
  }
});

test('allows legitimate commands', () => {
  for (const cmd of [
    'npm run electron:dev',
    'npm test',
    'git status',
    'taskkill /F /IM chrome.exe',
    'pkill -f vite',
    'echo "the electron build is ready"',
    'kill 999999', // a stale PID that is not the host
    'lsof -ti:4321 | xargs kill', // a different (auto-incremented) port
    'node scripts/step15-smoke.mjs',
    'npx vite --port 5173',
    'npm run dev',
  ]) {
    assert.equal(assessHostKillCommand(cmd), null, `expected allow for: ${cmd}`);
  }
});

test('ignores empty / non-string input', () => {
  assert.equal(assessHostKillCommand(''), null);
  assert.equal(assessHostKillCommand(undefined), null);
  assert.equal(assessHostKillCommand(null), null);
});
