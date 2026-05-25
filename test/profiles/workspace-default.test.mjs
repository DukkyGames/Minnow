/**
 * Workspace profile default mapping uses normalized path keys.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { readConfigJson } from '../../server/config/store.js';
import {
  setWorkspaceProfileDefault,
  saveProfileFile,
} from '../../server/profiles/handlers.js';

function setTestHome(env) {
  resetMinnowHomeCache();
  const dir = path.join(os.tmpdir(), `minnow-profiles-ws-${process.pid}`);
  env.MINNOW_HOME = dir;
  return dir;
}

const MIN_BUNDLE = {
  id: 'ws-default',
  label: 'WS Default',
  schemaVersion: 1,
  prompt: {
    promptProfile: 'full',
    activePromptConfigId: null,
    activeInfoPresetId: 'general-assistant',
    source: 'full',
  },
  agents: { workAgents: {}, subAgents: {} },
  tools: { permissions: {}, replaceAll: false },
};

describe('workspace profile default', () => {
  before(async () => {
    setTestHome(process.env);
    await ensureMinnowLayout();
    await saveProfileFile(MIN_BUNDLE);
  });

  after(() => {
    resetMinnowHomeCache();
  });

  test('setWorkspaceProfileDefault persists normalized key', async () => {
    const workspacePath = path.join(os.tmpdir(), 'minnow-ws-profile-project');
    const result = await setWorkspaceProfileDefault(workspacePath, 'ws-default');
    assert.ok(result.workspacePath);

    const meta = await readConfigJson('config.json');
    const mapped = meta.workspaceProfiles?.[result.workspacePath];
    assert.equal(mapped, 'ws-default');
  });
});
