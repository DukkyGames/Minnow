import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessHostKillCommand } from '../../server/tools/host-kill-guard.js';

// The scheduler base URL defaults to http://localhost:${PORT || 5173}, so the
// guard treats 5173 as the live dev port in tests.

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
    'Get-NetTCPConnection -LocalPort 5173 | Stop-Process -Id { $_.OwningProcess }',
    'lsof -ti:5173 | xargs kill -9',
    'fuser -k 5173/tcp',
    'kill $(lsof -ti:5173)',
  ]) {
    const result = assessHostKillCommand(cmd);
    assert.ok(result, `expected block for: ${cmd}`);
  }
});

test('blocks killing the host node PID', () => {
  const result = assessHostKillCommand(`taskkill /F /PID ${process.pid}`);
  assert.ok(result);
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
  ]) {
    assert.equal(assessHostKillCommand(cmd), null, `expected allow for: ${cmd}`);
  }
});

test('ignores empty / non-string input', () => {
  assert.equal(assessHostKillCommand(''), null);
  assert.equal(assessHostKillCommand(undefined), null);
  assert.equal(assessHostKillCommand(null), null);
});
