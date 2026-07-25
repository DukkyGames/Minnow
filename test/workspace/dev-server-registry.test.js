import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { readConfigJson, writeConfigJson } from '../../server/config/store.js';
import { mergeConfigMeta } from '../../server/config/validators.js';
import {
  createDevServer,
  deleteDevServer,
  readDevServers,
  resetDevServerRegistryForTests,
  updateDevServer,
} from '../../server/dev-server/registry.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

describe('dev-server registry', () => {
  let homeDir;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-dev-server-registry');
    resetDevServerRegistryForTests();
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'reg-ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    await setWorkspaceRoot(workspaceDir);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  async function clearRegistry() {
    const meta = (await readConfigJson('config.json')) ?? {};
    const workspace =
      meta.workspace && typeof meta.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
        : {};
    delete workspace.devServersByPath;
    await writeConfigJson('config.json', mergeConfigMeta(meta, { workspace }));
    resetDevServerRegistryForTests();
  }

  test('seeds primary from startup.md when registry empty', async () => {
    await clearRegistry();
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      '---\ncommand: npm run dev\ncwd: .\nhealthUrl: http://localhost:5173/\n---\n',
      'utf8',
    );
    const list = await readDevServers(workspaceDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'primary');
    assert.equal(list[0].source, 'startup.md');
    assert.equal(list[0].command, 'npm run dev');
  });

  test('startup.md-linked entry re-reads command from disk', async () => {
    await clearRegistry();
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      '---\ncommand: npm run first\ncwd: .\n---\n',
      'utf8',
    );
    await readDevServers(workspaceDir);
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      '---\ncommand: npm run second\ncwd: apps/web\n---\n',
      'utf8',
    );
    const list = await readDevServers(workspaceDir);
    assert.equal(list[0].command, 'npm run second');
    assert.equal(list[0].cwd, 'apps/web');
  });

  test('CRUD for user-defined servers', async () => {
    await clearRegistry();
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      '---\ncommand: npm run dev\n---\n',
      'utf8',
    );
    await readDevServers(workspaceDir);
    const created = await createDevServer(workspaceDir, {
      name: 'api',
      command: 'npm run api',
      port: 3001,
    });
    assert.equal(created.source, 'user');
    const updated = await updateDevServer(workspaceDir, created.id, { port: 3002 });
    assert.equal(updated.port, 3002);
    await deleteDevServer(workspaceDir, created.id);
    const list = await readDevServers(workspaceDir);
    assert.equal(list.some((s) => s.id === created.id), false);
  });
});
