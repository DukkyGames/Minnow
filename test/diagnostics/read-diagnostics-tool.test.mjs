import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';
import { appendDiagnosticEntry } from '../../server/diagnostics/ring-log.js';

describe('read_diagnostics tool', () => {
  let testHome;

  before(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-read-diag-'));
    process.env.MINNOW_HOME = testHome;
    await appendDiagnosticEntry({
      kind: 'unhandledRejection',
      message: 'tool test failure',
      source: 'server',
    });
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    await fs.rm(testHome, { recursive: true, force: true });
  });

  test('returns JSON summary with errors', async () => {
    const { result } = await executeServerTool('read_diagnostics', {
      format: 'summary',
      source: 'server',
      maxLines: 10,
    });
    assert.ok(typeof result === 'string');
    const parsed = JSON.parse(result);
    assert.ok(parsed.health);
    assert.ok(Array.isArray(parsed.errors));
    assert.ok(parsed.errors.length >= 1);
  });

  test('report format returns markdown without home paths', async () => {
    const home = os.homedir();
    if (home) {
      await appendDiagnosticEntry({
        kind: 'uncaughtException',
        message: `failed in ${home}/project`,
        source: 'server',
      });
    }
    const { result } = await executeServerTool('read_diagnostics', {
      format: 'report',
      source: 'all',
    });
    assert.ok(typeof result === 'string');
    assert.match(result, /Minnow diagnostic report/);
    if (home) {
      assert.ok(!result.includes(home), 'report must redact home paths');
    }
  });
});
