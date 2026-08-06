import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { readConfigJson, writeConfigJson } from '../../server/config/store.js';
import { mergeConfigMeta } from '../../server/config/validators.js';
import {
  getDevServerStatus,
  getDevServerStatusById,
  resetDevServerManagerForTests,
  startDevServer,
  startDevServerById,
  stopDevServer,
  stopDevServerById,
  toolStartBackgroundCommand,
  toolStopBackgroundCommand,
} from '../../server/dev-server/manager.js';
import { PRIMARY_DEV_SERVER_ID } from '../../server/dev-server/registry.js';
import {
  getWorkspaceRoot,
  normalizeWorkspacePathKey,
  setWorkspaceRoot,
} from '../../server/workspace/root.js';
import { parseStartupMarkdown } from '../../server/dev-server/parse-startup.js';
import { longRunningDevServerCommand, rmTestHome, setTestHome } from '../config/test-helpers.js';

const LONG_RUNNING_CMD = longRunningDevServerCommand();

describe('dev-server manager tools', () => {
  let homeDir;
  let workspaceDir;
  /** @type {string | null} */
  let activeRunId = null;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-dev-server-manager');
    resetDevServerManagerForTests();
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'dev-ws-tool');
    await fs.mkdir(workspaceDir, { recursive: true });
    await setWorkspaceRoot(workspaceDir);
  });

  /** Drop persisted dev-server rows so reconcileRow does not reuse stale run ids. */
  async function clearPersistedDevServerState() {
    const meta = (await readConfigJson('config.json')) ?? {};
    const workspace =
      meta.workspace && typeof meta.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
        : {};
    delete workspace.devServerByPath;
    await writeConfigJson('config.json', mergeConfigMeta(meta, { workspace }));
    resetDevServerManagerForTests();
  }

  after(async () => {
    if (activeRunId) {
      await toolStopBackgroundCommand({ run_id: activeRunId });
      activeRunId = null;
    }
    await stopDevServer(workspaceDir).catch(() => undefined);
    await rmTestHome(homeDir);
  });

  afterEach(async () => {
    if (activeRunId) {
      await toolStopBackgroundCommand({ run_id: activeRunId });
      activeRunId = null;
    }
    await stopDevServer(workspaceDir).catch(() => undefined);
    await clearPersistedDevServerState();
  });

  test('startDevServer registers running state when startup.md guide matches', async () => {
    const startupContent = `---\ncommand: ${LONG_RUNNING_CMD}\ncwd: .\n---\n`;
    const parsed = parseStartupMarkdown(startupContent);
    assert.equal(parsed.guide?.command, LONG_RUNNING_CMD);

    await fs.writeFile(path.join(workspaceDir, 'startup.md'), startupContent, 'utf8');
    assert.equal(path.resolve(getWorkspaceRoot()), path.resolve(workspaceDir));

    const started = await startDevServer(workspaceDir);
    assert.equal(started.ok, true);
    assert.ok(started.runId);
    activeRunId = started.runId ?? null;

    const status = await getDevServerStatus(workspaceDir);
    assert.equal(status.status, 'running');
    assert.equal(status.runId, started.runId);

    const stopped = await stopDevServer(workspaceDir);
    assert.equal(stopped.ok, true);
    activeRunId = null;
    const afterStop = await getDevServerStatus(workspaceDir);
    assert.equal(afterStop.status, 'stopped');
  });

  test('toolStartBackgroundCommand returns ok for matching startup.md command', async () => {
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      `---\ncommand: ${LONG_RUNNING_CMD}\ncwd: .\n---\n`,
      'utf8',
    );

    const raw = await toolStartBackgroundCommand({ command: LONG_RUNNING_CMD, cwd: '.' });
    const result = JSON.parse(raw);
    assert.equal(result.ok, true);
    assert.ok(result.runId);
    activeRunId = result.runId;
  });

  test('toolStartBackgroundCommand skips registration for unrelated commands', async () => {
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      `---\ncommand: ${LONG_RUNNING_CMD}\ncwd: .\n---\n`,
      'utf8',
    );

    const raw = await toolStartBackgroundCommand({
      command:
        process.platform === 'win32'
          ? 'node -e setInterval(function(){},30000)'
          : 'node -e "setInterval(()=>{}, 30000)"',
      cwd: '.',
    });
    const result = JSON.parse(raw);
    assert.equal(result.ok, true);
    activeRunId = result.runId;

    const status = await getDevServerStatus(workspaceDir);
    assert.equal(status.status, 'stopped');
  });

  test('legacy flat persisted row migrates to servers.primary', async () => {
    await clearPersistedDevServerState();
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      `---\ncommand: ${LONG_RUNNING_CMD}\ncwd: .\n---\n`,
      'utf8',
    );
    const key = normalizeWorkspacePathKey(path.resolve(workspaceDir));
    const meta = (await readConfigJson('config.json')) ?? {};
    const workspace =
      meta.workspace && typeof meta.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
        : {};
    workspace.devServerByPath = {
      [key]: {
        status: 'stopped',
        runId: null,
        pid: null,
        command: LONG_RUNNING_CMD,
        healthUrl: null,
        port: 3000,
        error: null,
        startedAt: null,
      },
    };
    await writeConfigJson('config.json', mergeConfigMeta(meta, { workspace }));
    resetDevServerManagerForTests();

    const status = await getDevServerStatusById(workspaceDir, PRIMARY_DEV_SERVER_ID);
    assert.equal(status.status, 'stopped');
    assert.equal(status.command, LONG_RUNNING_CMD);

    const started = await startDevServerById(workspaceDir, PRIMARY_DEV_SERVER_ID);
    assert.equal(started.ok, true);
    activeRunId = started.runId ?? null;
    const stopped = await stopDevServerById(workspaceDir, PRIMARY_DEV_SERVER_ID);
    assert.equal(stopped.ok, true);
    activeRunId = null;

    const after = (await readConfigJson('config.json')) ?? {};
    const ws = after.workspace && typeof after.workspace === 'object' ? after.workspace : {};
    const byPath = ws.devServerByPath && typeof ws.devServerByPath === 'object' ? ws.devServerByPath : {};
    const row = byPath[key];
    assert.ok(row && typeof row === 'object');
    assert.ok(row.servers && typeof row.servers === 'object');
    assert.ok(row.servers.primary);
  });

  test('persisted error with no runId lists as stopped; command from startup.md when idle', async () => {
    await clearPersistedDevServerState();
    const guideCmd = LONG_RUNNING_CMD;
    const staleCmd = 'npm run stale-dev-server';
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      `---\ncommand: ${guideCmd}\ncwd: .\n---\n`,
      'utf8',
    );
    const key = normalizeWorkspacePathKey(path.resolve(workspaceDir));
    const meta = (await readConfigJson('config.json')) ?? {};
    const workspace =
      meta.workspace && typeof meta.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (meta.workspace) }
        : {};
    workspace.devServerByPath = {
      [key]: {
        servers: {
          primary: {
            status: 'error',
            runId: null,
            pid: null,
            command: staleCmd,
            healthUrl: null,
            port: 9999,
            error: 'Health check timed out',
            startedAt: null,
          },
        },
      },
    };
    await writeConfigJson('config.json', mergeConfigMeta(meta, { workspace }));
    resetDevServerManagerForTests();

    const status = await getDevServerStatusById(workspaceDir, PRIMARY_DEV_SERVER_ID);
    assert.equal(status.status, 'stopped');
    assert.equal(status.command, guideCmd);
    assert.equal(status.error, null);
    assert.equal(status.lastError, 'Health check timed out');
  });
});
