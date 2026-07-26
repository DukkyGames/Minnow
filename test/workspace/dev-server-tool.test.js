import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { readConfigJson, writeConfigJson } from '../../server/config/store.js';
import { mergeConfigMeta } from '../../server/config/validators.js';
import { resetDevServerRegistryForTests } from '../../server/dev-server/registry.js';
import { toolManageDevServers } from '../../server/dev-server/tool-handler.js';
import { setWorkspaceRoot, normalizeWorkspacePathKey } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

describe('manage_dev_servers tool', { concurrency: 1 }, () => {
  let homeDir;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-dev-server-tool');
    resetDevServerRegistryForTests();
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'tool-ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    await setWorkspaceRoot(workspaceDir);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  async function clearRegistry() {
    await fs.unlink(path.join(workspaceDir, 'startup.md')).catch(() => undefined);
    const meta = (await readConfigJson('config.json')) ?? {};
    const workspace =
      meta.workspace && typeof meta.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
        : {};
    const key = normalizeWorkspacePathKey(workspaceDir);
    const serversByPath =
      workspace.devServersByPath && typeof workspace.devServersByPath === 'object'
        ? { .../** @type {Record<string, unknown>} */ (workspace.devServersByPath) }
        : {};
    serversByPath[key] = { servers: [] };
    workspace.devServersByPath = serversByPath;

    const stateByPath =
      workspace.devServerByPath && typeof workspace.devServerByPath === 'object'
        ? { .../** @type {Record<string, unknown>} */ (workspace.devServerByPath) }
        : {};
    delete stateByPath[key];
    workspace.devServerByPath = stateByPath;

    await writeConfigJson('config.json', mergeConfigMeta(meta, { workspace }));
    resetDevServerRegistryForTests();
  }

  test('create and list registry entries', async () => {
    await clearRegistry();
    const created = await toolManageDevServers({
      action: 'create',
      id: 'api',
      name: 'api',
      command: 'npm run api',
      cwd: 'services/api',
      port: 3001,
      healthUrl: 'http://localhost:3001/',
    });
    assert.match(created, /Created dev server "api"/);
    assert.match(created, /"command": "npm run api"/);

    const listed = await toolManageDevServers({ action: 'list' });
    assert.match(listed, /id=api/);
    assert.match(listed, /status=stopped/);
  });

  test('update user-defined server', async () => {
    await clearRegistry();
    const created = await toolManageDevServers({
      action: 'create',
      name: 'web',
      command: 'npm run dev',
      port: 3000,
    });
    const idMatch = created.match(/\(id=([^)]+)\)/);
    assert.ok(idMatch, 'expected id in create response');
    const id = idMatch[1];

    const updated = await toolManageDevServers({
      action: 'update',
      id,
      port: 3002,
      autoStart: true,
    });
    assert.match(updated, /Updated dev server "web"/);
    assert.match(updated, /"port": 3002/);
    assert.match(updated, /"autoStart": true/);
  });

  test('delete requires confirmation and blocks startup.md rows', async () => {
    await clearRegistry();
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      '---\ncommand: npm run dev\n---\n',
      'utf8',
    );
    const listed = await toolManageDevServers({ action: 'list' });
    assert.match(listed, /source=startup\.md/);

    const blocked = await toolManageDevServers({
      action: 'delete',
      id: 'primary',
      confirmed: true,
    });
    assert.match(blocked, /cannot delete startup\.md-linked servers/);

    const created = await toolManageDevServers({
      action: 'create',
      name: 'temp',
      command: 'npm run temp',
    });
    const idMatch = created.match(/\(id=([^)]+)\)/);
    assert.ok(idMatch);
    const id = idMatch[1];

    const needsConfirm = await toolManageDevServers({ action: 'delete', id });
    assert.match(needsConfirm, /requires confirmation/);

    const deleted = await toolManageDevServers({ action: 'delete', id, confirmed: true });
    assert.match(deleted, /Deleted dev server "temp"/);
  });

  test('rejects unknown action', async () => {
    const result = await toolManageDevServers({ action: 'bootstrap' });
    assert.match(result, /unknown action/);
  });
});
