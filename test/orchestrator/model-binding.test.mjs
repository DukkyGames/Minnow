/**
 * resolveAttemptModel: board override, Autopilot, then active chat.
 * A model id is enough; provider may be inferred or left empty.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { writeConfigJson, writeResource } from '../../server/config/store.js';
import { resolveAttemptModel } from '../../server/orchestrator/model-binding.js';

describe('resolveAttemptModel', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string | undefined} */
  let previousHome;
  /** @type {string | undefined} */
  let savedStore;

  beforeEach(async () => {
    previousHome = process.env.MINNOW_HOME;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-model-bind-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  afterEach(async () => {
    closeSessionsDb();
    if (previousHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = previousHome;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('prefers an override that already has both ids', async () => {
    const resolved = await resolveAttemptModel({
      providerId: 'anthropic',
      id: 'claude-opus-5',
    });
    assert.deepEqual(resolved, { providerId: 'anthropic', id: 'claude-opus-5' });
  });

  it('uses the Autopilot planner pair when the override is null', async () => {
    await writeConfigJson('config.json', {
      autopilot: {
        plannerProviderId: 'openai',
        plannerModelId: 'gpt-4.1',
      },
    });
    const resolved = await resolveAttemptModel(null);
    assert.deepEqual(resolved, { providerId: 'openai', id: 'gpt-4.1' });
  });

  it('resolves an active chat that has a model id and empty provider', async () => {
    await writeConfigJson('config.json', { autopilot: { plannerProviderId: '', plannerModelId: '' } });
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
          providerId: '',
          modelId: 'gguf:qwen3-8b',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 0,
          lastMessageAt: 0,
        },
      ],
    });

    const resolved = await resolveAttemptModel(null);
    assert.equal(resolved.id, 'gguf:qwen3-8b');
    assert.equal(resolved.providerId, 'minnow-library');
  });

  it('throws when every source is empty', async () => {
    await writeConfigJson('config.json', { autopilot: { plannerProviderId: '', plannerModelId: '' } });
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
          providerId: '',
          modelId: '',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 0,
          lastMessageAt: 0,
        },
      ],
    });

    await assert.rejects(
      () => resolveAttemptModel(null),
      /no model bound for this attempt/,
    );
  });
});
