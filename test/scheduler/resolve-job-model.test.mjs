/**
 * resolveJobRunModel — explicit job model vs active-chat menubar fallback.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { writeResource } from '../../server/config/store.js';
import { resolveJobRunModel } from '../../server/scheduler/resolve-job-model.js';

describe('resolveJobRunModel', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string | undefined} */
  let savedStore;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-resolve-job-model-'));
    process.env.MINNOW_HOME = homeDir;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    resetMinnowHomeCache();
  });

  after(async () => {
    closeSessionsDb();
    delete process.env.MINNOW_HOME;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('returns explicit provider and model from the job', async () => {
    const resolved = await resolveJobRunModel({
      providerId: 'lmstudio',
      modelId: 'qwen/qwen3-8b',
    });
    assert.deepEqual(resolved, {
      providerId: 'lmstudio',
      modelId: 'qwen/qwen3-8b',
    });
  });

  test('falls back to the active chat model when the job has no model', async () => {
    await writeResource('sessions', {
      version: 5,
      activeId: 'chat-active',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      groups: [],
      chats: [
        {
          id: 'chat-active',
          name: 'Active',
          workspacePath: '',
          providerId: 'ollama',
          modelId: 'llama3.2:latest',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 0,
          lastMessageAt: 0,
        },
      ],
    });

    const resolved = await resolveJobRunModel({ label: 'fallback job' });
    assert.deepEqual(resolved, {
      providerId: 'ollama',
      modelId: 'llama3.2:latest',
    });
  });

  test('returns empty bindings when job and active chat have no model', async () => {
    await writeResource('sessions', {
      version: 5,
      activeId: 'chat-empty',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      groups: [],
      chats: [
        {
          id: 'chat-empty',
          name: 'Empty',
          workspacePath: '',
          modelId: '',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 0,
          lastMessageAt: 0,
        },
      ],
    });

    const resolved = await resolveJobRunModel({});
    assert.deepEqual(resolved, {
      providerId: undefined,
      modelId: undefined,
    });
  });
});
