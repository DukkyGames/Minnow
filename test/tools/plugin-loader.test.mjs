import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { writeConfigJson } from '../../server/config/store.js';
import {
  callPluginTool,
  reloadPlugins,
} from '../../server/tools/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '../fixtures/plugin-tools');
const EXPECTED_TOOL = 'plugin__echo__ping';
const EXPECTED_RESULT = 'pong';

describe('plugin loader', () => {
  let homeDir;

  before(async () => {
    homeDir = path.join(os.tmpdir(), `minnow-plugin-loader-${process.pid}`);
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();

    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(path.join(homeDir, 'tools'), { recursive: true });
    await fs.cp(
      path.join(FIXTURE_ROOT, 'echo'),
      path.join(homeDir, 'tools', 'echo'),
      { recursive: true },
    );

    await writeConfigJson('tools.json', {
      enabled: {},
      permissions: { default: {} },
      keys: { braveApiKey: '' },
      plugins: { echo: { enabled: true } },
    });

    await reloadPlugins();
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await reloadPlugins();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('callPluginTool returns pong', async () => {
    const result = await callPluginTool(EXPECTED_TOOL, {});
    assert.equal(result, EXPECTED_RESULT);
  });

  test('reload clears and reloads handlers', async () => {
    const first = await callPluginTool(EXPECTED_TOOL, {});
    assert.equal(first, EXPECTED_RESULT);
    await reloadPlugins();
    const second = await callPluginTool(EXPECTED_TOOL, {});
    assert.equal(second, EXPECTED_RESULT);
  });

  test('disabled plugin is not loaded', async () => {
    await writeConfigJson('tools.json', {
      enabled: {},
      permissions: { default: {} },
      keys: { braveApiKey: '' },
      plugins: { echo: { enabled: false } },
    });
    await reloadPlugins();
    const result = await callPluginTool(EXPECTED_TOOL, {});
    assert.match(result, /not loaded|disabled/i);

    await writeConfigJson('tools.json', {
      enabled: {},
      permissions: { default: {} },
      keys: { braveApiKey: '' },
      plugins: { echo: { enabled: true } },
    });
    await reloadPlugins();
  });

  test('unknown plugin returns error string', async () => {
    const result = await callPluginTool('plugin__missing__ping', {});
    assert.match(result, /^Error:/);
  });
});
