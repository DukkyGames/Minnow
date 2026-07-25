/**
 * resolveSynthesisModel fallback chain (email triage, reply variants, memory synthesis).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { writeWholeSessionState } from '../../server/config/sessions-repo.js';
import { writeConfigJson } from '../../server/config/store.js';
import { validateSessionState } from '../../server/config/validators.js';
import {
  DEFAULT_SYNTHESIS_CONFIG,
  resolveSynthesisModel,
} from '../../server/memory/synthesis-config.js';

const MODEL_SELECT_KEY_SEP = '\u001f';

describe('resolveSynthesisModel', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string | undefined} */
  let savedStore;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-synth-resolve-'));
    process.env.MINNOW_HOME = homeDir;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    resetMinnowHomeCache();

    await writeConfigJson('config.json', {
      activeProviderId: 'lm-studio-local',
      titles: { providerId: '', modelId: '' },
    });

    // Seed via SQLite whole-blob write (state.json is no longer the live store).
    writeWholeSessionState(
      validateSessionState({
        version: 6,
        activeId: 'chat-1',
        chats: [
          {
            id: 'chat-1',
            name: 'Test',
            providerId: '',
            modelId: `lm-studio-local${MODEL_SELECT_KEY_SEP}test-model`,
            history: [],
            updatedAt: 1,
          },
        ],
      }),
    );
  });

  after(async () => {
    closeSessionsDb();
    delete process.env.MINNOW_HOME;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('decodes composite menubar model key from active chat', async () => {
    const model = await resolveSynthesisModel(DEFAULT_SYNTHESIS_CONFIG);
    assert.ok(model);
    assert.equal(model.providerId, 'lm-studio-local');
    assert.equal(model.model, 'test-model');
  });

  test('prefers explicit synthesis utility override', async () => {
    const model = await resolveSynthesisModel({
      ...DEFAULT_SYNTHESIS_CONFIG,
      utilityProviderId: 'custom-provider',
      utilityModelId: 'custom-model',
    });
    assert.ok(model);
    assert.equal(model.providerId, 'custom-provider');
    assert.equal(model.model, 'custom-model');
  });

  test('uses titles model with active provider when provider omitted', async () => {
    await writeConfigJson('config.json', {
      activeProviderId: 'lm-studio-local',
      titles: { providerId: '', modelId: 'title-model' },
    });

    const model = await resolveSynthesisModel(DEFAULT_SYNTHESIS_CONFIG);
    assert.ok(model);
    assert.equal(model.providerId, 'lm-studio-local');
    assert.equal(model.model, 'title-model');
  });
});
