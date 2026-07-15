import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  DIAGNOSTICS_LOG_MAX_BYTES,
  appendDiagnosticEntry,
  clearDiagnosticLogs,
  diagnosticsLogPath,
  readDiagnosticEntries,
  resetDiagnosticWriteQueuesForTests,
} from '../../server/diagnostics/ring-log.js';

describe('diagnostics ring-log', () => {
  let testHome;

  beforeEach(async () => {
    resetDiagnosticWriteQueuesForTests();
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-diag-log-'));
    process.env.MINNOW_HOME = testHome;
  });

  afterEach(async () => {
    resetDiagnosticWriteQueuesForTests();
    delete process.env.MINNOW_HOME;
    await fs.rm(testHome, { recursive: true, force: true });
  });

  test('appendDiagnosticEntry writes JSONL under MINNOW_HOME/logs', async () => {
    await appendDiagnosticEntry({ kind: 'test', message: 'hello', source: 'server' });
    const logPath = diagnosticsLogPath();
    const raw = await fs.readFile(logPath, 'utf8');
    const line = JSON.parse(raw.trim());
    assert.equal(line.kind, 'test');
    assert.equal(line.message, 'hello');
    assert.equal(typeof line.ts, 'string');
  });

  test('readDiagnosticEntries returns tail in chronological order', async () => {
    await appendDiagnosticEntry({ kind: 'a', message: 'first', source: 'server' });
    await appendDiagnosticEntry({ kind: 'b', message: 'second', source: 'server' });
    const entries = await readDiagnosticEntries({ maxLines: 10 });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, 'first');
    assert.equal(entries[1].message, 'second');
  });

  test('rotates when file exceeds size cap', async () => {
    const logPath = diagnosticsLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const bigLine = `${'x'.repeat(DIAGNOSTICS_LOG_MAX_BYTES)}\n`;
    await fs.writeFile(logPath, bigLine, 'utf8');

    await appendDiagnosticEntry({ kind: 'rotate-test', message: 'after-rotate', source: 'server' });

    const rotated = `${logPath}.1`;
    const rotatedStat = await fs.stat(rotated);
    assert.ok(rotatedStat.size >= DIAGNOSTICS_LOG_MAX_BYTES);
    const raw = await fs.readFile(logPath, 'utf8');
    assert.match(raw, /rotate-test/);
    const size = (await fs.stat(logPath)).size;
    assert.ok(size < DIAGNOSTICS_LOG_MAX_BYTES, 'active log should stay under cap after rotation');
  });

  test('clearDiagnosticLogs removes diagnostics and crash JSONL files', async () => {
    await appendDiagnosticEntry({ kind: 'a', message: 'before-clear', source: 'server' });
    const crashPath = path.join(path.dirname(diagnosticsLogPath()), 'crash.jsonl');
    await fs.writeFile(crashPath, '{"kind":"crash"}\n', 'utf8');

    await clearDiagnosticLogs();

    const entries = await readDiagnosticEntries({ maxLines: 10 });
    assert.equal(entries.length, 0);
    await assert.rejects(() => fs.stat(diagnosticsLogPath()), /ENOENT/);
    await assert.rejects(() => fs.stat(crashPath), /ENOENT/);
  });
});
