/**
 * Phase A.2 — SQLite terminal history concurrency.
 * appendTerminalRun must land under parallel writers; whole-blob PUT must not
 * clobber server-owned terminalHistory.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  appendTerminalRun,
  readTerminalHistory,
  writeWholeSessionState,
} from '../../server/config/sessions-repo.js';
import { validateSessionState } from '../../server/config/validators.js';
import { rmTestHome, setTestHome } from './test-helpers.js';

function makeRecord(recordId) {
  return {
    id: recordId,
    command: 'npm test',
    cwd: '/workspace',
    source: 'agent',
    startedAt: 1,
    finishedAt: 2,
    exitCode: 0,
    timedOut: false,
    logPath: `logs/${recordId}.log`,
  };
}

describe('config store concurrency', () => {
  let homeDir;
  let savedStore;

  before(() => {
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, 'minnow-test-store-concurrency');
  });

  after(async () => {
    closeSessionsDb();
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    await rmTestHome(homeDir);
  });

  test('parallel appendTerminalRun keeps all terminal records', async () => {
    const chatId = '11111111-1111-1111-1111-111111111111';
    const seed = validateSessionState({
      version: 3,
      chats: [
        {
          id: chatId,
          title: 'Orchestrate task',
          updatedAt: 1,
          terminalHistory: [],
        },
      ],
    });
    writeWholeSessionState(seed);

    await Promise.all([
      Promise.resolve().then(() => appendTerminalRun(chatId, makeRecord('run-a'))),
      Promise.resolve().then(() => appendTerminalRun(chatId, makeRecord('run-b'))),
      Promise.resolve().then(() => appendTerminalRun(chatId, makeRecord('run-c'))),
    ]);

    const ids = readTerminalHistory(chatId).map((r) => r.id).sort();
    assert.deepEqual(ids, ['run-a', 'run-b', 'run-c']);
  });

  test('writeWholeSessionState racing appendTerminalRun preserves all terminal rows', async () => {
    const chatId = '22222222-2222-2222-2222-222222222222';
    const seed = validateSessionState({
      version: 6,
      chats: [
        {
          id: chatId,
          name: 'Race chat',
          updatedAt: 1,
          history: [{ role: 'user', content: 'hi' }],
        },
      ],
    });
    writeWholeSessionState(seed);

    // Stale client blob omits (or empties) terminalHistory — must not wipe server rows.
    const staleClientBlob = validateSessionState({
      version: 6,
      activeId: chatId,
      chats: [
        {
          id: chatId,
          name: 'Race chat (stale)',
          updatedAt: 2,
          history: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
          terminalHistory: [],
        },
      ],
    });

    await Promise.all([
      Promise.resolve().then(() => appendTerminalRun(chatId, makeRecord('race-a'))),
      Promise.resolve().then(() => appendTerminalRun(chatId, makeRecord('race-b'))),
      Promise.resolve().then(() => appendTerminalRun(chatId, makeRecord('race-c'))),
      Promise.resolve().then(() => writeWholeSessionState(staleClientBlob)),
    ]);

    const ids = readTerminalHistory(chatId).map((r) => r.id).sort();
    assert.deepEqual(ids, ['race-a', 'race-b', 'race-c']);
  });
});
