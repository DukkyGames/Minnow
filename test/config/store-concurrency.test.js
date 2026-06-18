import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readConfigJson, updateConfigJson, writeConfigJson } from '../../server/config/store.js';
import { validateSessionState } from '../../server/config/validators.js';
import { rmTestHome, setTestHome } from './test-helpers.js';

describe('config store concurrency', () => {
  let homeDir;

  before(() => {
    homeDir = setTestHome(process.env, 'minnow-test-store-concurrency');
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  test('parallel sessions/state.json read-modify-write keeps all terminal records', async () => {
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
    await writeConfigJson('sessions/state.json', seed);

    const appendRecord = async (recordId) => {
      await updateConfigJson('sessions/state.json', (raw) => {
        const base = raw ?? { version: 3, chats: [] };
        const state = validateSessionState(base);
        const chat = state.chats.find((c) => c.id === chatId);
        if (!chat) throw new Error('missing chat');
        const history = Array.isArray(chat.terminalHistory) ? [...chat.terminalHistory] : [];
        history.push({
          id: recordId,
          command: 'npm test',
          cwd: '/workspace',
          source: 'agent',
          startedAt: 1,
          finishedAt: 2,
          exitCode: 0,
          timedOut: false,
          logPath: `logs/${recordId}.log`,
        });
        chat.terminalHistory = history;
        chat.updatedAt = Date.now();
        return state;
      });
    };

    await Promise.all([
      appendRecord('run-a'),
      appendRecord('run-b'),
      appendRecord('run-c'),
    ]);

    const finalRaw = await readConfigJson('sessions/state.json');
    const final = validateSessionState(finalRaw);
    const chat = final.chats.find((c) => c.id === chatId);
    assert.ok(chat);
    const ids = (chat.terminalHistory ?? []).map((r) => r.id).sort();
    assert.deepEqual(ids, ['run-a', 'run-b', 'run-c']);
  });
});
