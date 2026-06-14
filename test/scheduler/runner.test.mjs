/**
 * Scheduler runner subprocess tests with a fake minnow CLI.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { createJob, getStoredJobById } from '../../server/scheduler/store.js';
import { listRunsForJob, runStoredJob } from '../../server/scheduler/runner.js';

describe('scheduler runner', () => {
  /** @type {string} */
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scheduler-runner-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('captures fake subprocess JSON and records completed run', async () => {
    const payload = {
      version: 1,
      ok: true,
      exitCode: 0,
      assistantFinal: 'All good',
      error: null,
    };

    const fakeSpawn = () => {
      const handlers = {};
      return {
        stdout: {
          on: (event, fn) => {
            if (event === 'data') handlers.stdout = fn;
          },
        },
        stderr: { on: () => undefined },
        on: (event, fn) => {
          if (event === 'close') {
            queueMicrotask(() => {
              handlers.stdout?.(Buffer.from(`${JSON.stringify(payload)}\n`));
              fn(0);
            });
          }
        },
        kill: () => undefined,
      };
    };

    const created = await createJob({
      label: 'Runner test',
      schedule: { kind: 'interval', value: '60s' },
      prompt: 'Say OK',
      modeId: 'build',
      channels: ['in_app'],
    });

    const stored = await getStoredJobById(created.id);
    assert.ok(stored);

    const result = await runStoredJob(stored, {
      baseUrl: 'http://127.0.0.1:5173',
      spawn: fakeSpawn,
    });
    assert.equal(result.started, true);
    assert.equal(result.status, 'completed');

    const runs = await listRunsForJob(created.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'completed');
    assert.match(runs[0].output ?? '', /All good/);

    const after = await getStoredJobById(created.id);
    assert.equal(after?.running, false);
    assert.ok(after?.lastRunAt);
    assert.ok(after?.nextRunAt);
  });

  test('skips overlapping runs for the same job', async () => {
    const created = await createJob({
      label: 'Overlap',
      schedule: { kind: 'interval', value: '60s' },
      prompt: 'busy',
      modeId: 'build',
      channels: ['in_app'],
    });

    const stored = await getStoredJobById(created.id);
    assert.ok(stored);
    stored.running = true;

    const result = await runStoredJob(stored);
    assert.equal(result.started, false);
    assert.equal(result.reason, 'already_running');
  });
});
