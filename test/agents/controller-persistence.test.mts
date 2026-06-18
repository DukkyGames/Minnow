/**
 * MIN-140 Phase 3 — persistence + startup reconciliation.
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import {
  createConfigTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from '../config/test-helpers.js';
import {
  buildResultKey,
  writeCommittedResult,
  writeRegistryRecord,
} from '../../server/runs/store.js';
import {
  flushMirrorsForTests,
  isRunPersistenceEnabled,
  loadRegistry,
  mirrorRegistryEntry,
  pendingMirrorCountForTests,
  reconcilePersistedRegistry,
  resetMirrorCoalesceForTests,
  resultCommitKey,
  setRunsPersistenceApiBase,
  supersedeOlderAttempts,
} from '../../src/agents/controller/persistence.ts';

const PARENT_CHAT = '11111111-1111-1111-1111-111111111111';
const BOARD_TASK = 'task-persist-001';
const RUN_ID = 'run-persist-001';
const RUN_ID_OLD = 'run-persist-old';

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    boardTaskId: BOARD_TASK,
    lifecycle: 'running',
    attempt: 1,
    idempotencyKey: 'idem-11111111-1111-1111-1111-111111111111',
    committedResultRef: null,
    lastHeartbeatAt: 1000,
    lastProgressAt: 900,
    progressSeq: 3,
    status: 'running',
    type: 'explore',
    task: 'Reconcile me',
    parentChatId: PARENT_CHAT,
    startedAt: '2026-06-16T12:00:00.000Z',
    endedAt: null,
    summary: '',
    error: null,
    category: 'research',
    ...overrides,
  };
}

describe('controller persistence', () => {
  let homeDir: string;
  let server: ReturnType<typeof createConfigTestServer>;
  let baseUrl: string;

  before(async () => {
    homeDir = setTestHome(process.env);
    server = createConfigTestServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no server address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
    setRunsPersistenceApiBase(baseUrl);
  });

  after(async () => {
    setRunsPersistenceApiBase('');
    await new Promise<void>((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
  });

  beforeEach(async () => {
    const registryDir = `${homeDir}/runs/registry`;
    const resultsDir = `${homeDir}/runs/results`;
    await import('node:fs/promises').then((fs) =>
      Promise.all([
        fs.rm(registryDir, { recursive: true, force: true }),
        fs.rm(resultsDir, { recursive: true, force: true }),
      ]),
    );
  });

  afterEach(() => {
    setRunsPersistenceApiBase(baseUrl);
    resetMirrorCoalesceForTests();
  });

  test('resultCommitKey matches server buildResultKey', () => {
    assert.equal(resultCommitKey(BOARD_TASK, 2), buildResultKey(BOARD_TASK, 2));
  });

  test('registry PUT round-trips via API', async () => {
    const record = baseRecord();
    const put = await httpRequest(
      baseUrl,
      'PUT',
      `/api/config/runs/registry/${RUN_ID}`,
      record,
    );
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/runs/registry');
    assert.equal(get.status, 200);
    assert.equal(get.json.records.length, 1);
    assert.equal(get.json.records[0].runId, RUN_ID);
  });

  test('reconcile: committed result present finalizes via handler', async () => {
    const key = resultCommitKey(BOARD_TASK, 1);
    const aggregate = {
      runId: RUN_ID,
      type: 'explore',
      status: 'completed',
      summary: 'Reconciled summary',
      outcome: { summary: 'Reconciled summary', findings: [], artifacts: [] },
      startedAt: '2026-06-16T12:00:00.000Z',
      endedAt: '2026-06-16T12:05:00.000Z',
      toolTurns: 2,
      cancelled: false,
    };

    await writeCommittedResult(key, aggregate);
    await writeRegistryRecord(
      baseRecord({
        committedResultRef: key,
        lifecycle: 'done_unacked',
        status: 'running',
      }),
    );

    const finalized: string[] = [];
    const interrupted: string[] = [];

    await reconcilePersistedRegistry({
      finalizeCompleted: async (record) => {
        finalized.push(record.runId);
      },
      reconcileInterrupted: async (record) => {
        interrupted.push(record.runId);
      },
    });

    assert.deepEqual(finalized, [RUN_ID]);
    assert.deepEqual(interrupted, []);
  });

  test('reconcile: absent committed result routes to interrupted handler', async () => {
    await writeRegistryRecord(
      baseRecord({
        lifecycle: 'running',
        committedResultRef: null,
      }),
    );

    const finalized: string[] = [];
    const interrupted: string[] = [];

    await reconcilePersistedRegistry({
      finalizeCompleted: async (record) => {
        finalized.push(record.runId);
      },
      reconcileInterrupted: async (record) => {
        interrupted.push(record.runId);
      },
    });

    assert.deepEqual(finalized, []);
    assert.deepEqual(interrupted, [RUN_ID]);
  });

  test('supersedeOlderAttempts marks lower attempt interrupted', async () => {
    await writeRegistryRecord(
      baseRecord({
        runId: RUN_ID_OLD,
        attempt: 1,
        idempotencyKey: 'idem-old',
        lifecycle: 'running',
      }),
    );
    await writeRegistryRecord(
      baseRecord({
        runId: RUN_ID,
        attempt: 2,
        idempotencyKey: 'idem-new',
        lifecycle: 'running',
      }),
    );

    await supersedeOlderAttempts(BOARD_TASK, 2);

    const records = await loadRegistry();
    const old = records.find((r) => r.runId === RUN_ID_OLD);
    const current = records.find((r) => r.runId === RUN_ID);

    assert.equal(old?.lifecycle, 'interrupted');
    assert.equal(old?.error, 'superseded');
    assert.equal(current?.lifecycle, 'running');
    assert.equal(current?.idempotencyKey, 'idem-new');
  });

  test('mirrorRegistryEntry coalesces multiple updates into one PUT', async () => {
    if (!isRunPersistenceEnabled()) return;
    const run = {
      runId: RUN_ID,
      type: 'explore',
      task: 'Coalesce test',
      status: 'running' as const,
      lifecycle: 'running' as const,
      parentChatId: PARENT_CHAT,
      parentToolCallId: null,
      parentTurnId: null,
      summary: '',
      error: null,
      startedAt: '2026-06-16T12:00:00.000Z',
      endedAt: null,
      toolTurns: 0,
      maxToolTurns: 10,
      cancelled: false,
      messages: [],
    };

    mirrorRegistryEntry(run);
    mirrorRegistryEntry({ ...run, progressSeq: 1 });
    mirrorRegistryEntry({ ...run, progressSeq: 2, summary: 'latest' });
    assert.equal(pendingMirrorCountForTests(), 1);
    flushMirrorsForTests();
    assert.equal(pendingMirrorCountForTests(), 0);

    const get = await httpRequest(baseUrl, 'GET', '/api/config/runs/registry');
    assert.equal(get.status, 200);
    const row = get.json.records.find((r: { runId: string }) => r.runId === RUN_ID);
    assert.equal(row?.summary, 'latest');
    assert.equal(row?.progressSeq, 2);
  });

  test('supersedeOlderAttempts no-ops for first attempt', async () => {
    await supersedeOlderAttempts(BOARD_TASK, 1);
    const records = await loadRegistry();
    assert.equal(records.length, 0);
  });
});
