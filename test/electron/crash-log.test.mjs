import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  clearLastCrashMarker,
  clearOomPauseMarker,
  flushCrashLogSync,
  logCrash,
  readLastCrashMarker,
  readOomPauseMarker,
  resetCrashLogDirCache,
  resolveCrashLogDir,
  writeLastCrashMarker,
  writeOomPauseMarker,
} from '../../electron/dist/crash-log.js';

function tempLogDir() {
  return path.join(os.tmpdir(), `minnow-crash-log-test-${process.pid}-${Date.now()}`);
}

describe('crash-log', () => {
  let testDir;
  let savedHome;

  beforeEach(() => {
    resetCrashLogDirCache();
    testDir = tempLogDir();
    savedHome = process.env.MINNOW_HOME;
    process.env.MINNOW_HOME = testDir;
    resetCrashLogDirCache();
  });

  afterEach(() => {
    resetCrashLogDirCache();
    if (savedHome === undefined) {
      delete process.env.MINNOW_HOME;
    } else {
      process.env.MINNOW_HOME = savedHome;
    }
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('resolveCrashLogDir uses MINNOW_HOME/logs', () => {
    const dir = resolveCrashLogDir();
    assert.equal(dir, path.join(testDir, 'logs'));
    assert.ok(fs.existsSync(dir));
  });

  test('resolveCrashLogDir honors explicit override', () => {
    resetCrashLogDirCache();
    const override = path.join(testDir, 'custom-logs');
    const dir = resolveCrashLogDir({ override });
    assert.equal(dir, override);
    assert.ok(fs.existsSync(dir));
  });

  test('logCrash appends JSONL lines with ts and pid', () => {
    logCrash({ kind: 'test', message: 'boom', source: 'main' });
    flushCrashLogSync();
    const logPath = path.join(resolveCrashLogDir(), 'crash.jsonl');
    const raw = fs.readFileSync(logPath, 'utf8').trim();
    const line = JSON.parse(raw);
    assert.equal(line.kind, 'test');
    assert.equal(line.message, 'boom');
    assert.equal(line.source, 'main');
    assert.equal(typeof line.ts, 'string');
    assert.equal(line.pid, process.pid);
  });

  test('logCrash never throws on invalid path', () => {
    resetCrashLogDirCache();
    fs.mkdirSync(testDir, { recursive: true });
    const badDir = path.join(testDir, 'not-a-dir-file');
    fs.writeFileSync(badDir, 'block', 'utf8');
    const logsUnderBad = path.join(badDir, 'logs');
    assert.doesNotThrow(() => {
      resolveCrashLogDir({ override: logsUnderBad });
      logCrash({ kind: 'ignored', message: 'should not throw' });
    });
  });

  test('last crash marker round-trip and clear', () => {
    writeLastCrashMarker({
      kind: 'render-process-gone',
      reason: 'crashed',
      exitCode: 1,
      message: 'Renderer died',
    });
    const marker = readLastCrashMarker();
    assert.ok(marker);
    assert.equal(marker.kind, 'render-process-gone');
    assert.equal(marker.reason, 'crashed');
    assert.equal(marker.exitCode, 1);
    assert.equal(typeof marker.ts, 'string');

    clearLastCrashMarker();
    assert.equal(readLastCrashMarker(), null);
  });

  test('clearLastCrashMarker ignores ENOENT', () => {
    assert.doesNotThrow(() => clearLastCrashMarker());
  });

  test('OOM pause marker round-trip and expiry', () => {
    const recent = new Date().toISOString();
    writeOomPauseMarker({ ts: recent });
    const marker = readOomPauseMarker();
    assert.ok(marker);
    assert.equal(marker.reason, 'oom');

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeOomPauseMarker({ ts: stale });
    assert.equal(readOomPauseMarker(), null);

    writeOomPauseMarker({ ts: recent });
    clearOomPauseMarker();
    assert.equal(readOomPauseMarker(), null);
  });
});
