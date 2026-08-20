/**
 * llama.cpp runtime version drift and memoized --help probe.
 * mock.module must run before llama-runtime.js loads so PATH lookups and
 * GitHub asset fetches stay offline.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/** Counts GitHub asset-list calls — installManagedLlamaServer hits this, ensureLlamaServer must not. */
let fetchAssetListCalls = 0;
/** Counts llama-server --help probes (thinking-budget detection). */
let helpProbeCalls = 0;

mock.module('../../server/models/llama-variant.js', {
  namedExports: {
    detectPreferredLlamaVariant: async () => 'cpu',
    fetchReleaseAssetList: async () => {
      fetchAssetListCalls += 1;
      return [];
    },
    isGpuCapableVariant: () => false,
    listInstallableVariants: () => ['cpu'],
    resolveLlamaAssets: () => {
      throw new Error('install must not run during version-drift ensureLlamaServer tests');
    },
  },
});

mock.module('../../server/process-runner.js', {
  namedExports: {
    runProcess: async (command, args = []) => {
      if (args[0] === '--help') {
        helpProbeCalls += 1;
        return {
          code: 0,
          stdout: 'usage: llama-server --reasoning-budget N',
          stderr: '',
          timedOut: false,
        };
      }
      // `where` / `which` miss so resolveLlamaServer uses the planted managed binary.
      return { code: 1, stdout: '', stderr: '', timedOut: false };
    },
  },
});

const { resetMinnowHomeCache } = await import('../../server/config/home.js');
const {
  LLAMA_CPP_RELEASE_TAG,
  detectLlamaThinkingBudgetSupport,
  ensureLlamaServer,
  getLlamaRuntimeStatus,
  resetLlamaRuntimeInstallForTests,
} = await import('../../server/models/llama-runtime.js');

const BINARY_NAME = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

/**
 * Write a fake managed llama-server + meta.json under MINNOW_HOME.
 * @param {string} homeDir
 * @param {string} version
 */
async function plantManagedRuntime(homeDir, version) {
  const root = path.join(homeDir, 'models-runtime', 'llama-cpp');
  await fsp.mkdir(root, { recursive: true });
  const binary = path.join(root, BINARY_NAME);
  await fsp.writeFile(binary, 'fake-llama-server', 'utf8');
  await fsp.writeFile(
    path.join(root, 'meta.json'),
    `${JSON.stringify(
      {
        version,
        variant: 'cpu',
        assetNames: [],
        installedAt: '2020-01-01T00:00:00.000Z',
        path: binary,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return binary;
}

describe('llama runtime upgrade and probe cache', { concurrency: false }, () => {
describe('llama runtime version drift', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string | undefined} */
  let prevHome;

  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-llama-upgrade-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(async () => {
    resetLlamaRuntimeInstallForTests();
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await fsp.rm(homeDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchAssetListCalls = 0;
    resetLlamaRuntimeInstallForTests();
  });

  test('ensureLlamaServer keeps an older managed binary instead of reinstalling', async () => {
    const planted = await plantManagedRuntime(homeDir, 'b9628');
    const resolved = await ensureLlamaServer();
    assert.equal(resolved, planted);
    // fetchReleaseAssetList is only used by install + status — not by a no-op ensure.
    assert.equal(fetchAssetListCalls, 0);
  });

  test('getLlamaRuntimeStatus flags upgradeAvailable when managed version differs from the pin', async () => {
    await plantManagedRuntime(homeDir, 'b9628');
    const status = await getLlamaRuntimeStatus();
    assert.equal(status.installedVersion, 'b9628');
    assert.equal(status.pinnedVersion, LLAMA_CPP_RELEASE_TAG);
    assert.equal(status.version, 'b9628');
    assert.equal(status.upgradeAvailable, true);
    assert.notEqual(status.pinnedVersion, status.installedVersion);
  });

  test('getLlamaRuntimeStatus does not offer upgrade when managed version matches the pin', async () => {
    await plantManagedRuntime(homeDir, LLAMA_CPP_RELEASE_TAG);
    const status = await getLlamaRuntimeStatus();
    assert.equal(status.installedVersion, LLAMA_CPP_RELEASE_TAG);
    assert.equal(status.upgradeAvailable, false);
    assert.equal(status.version, LLAMA_CPP_RELEASE_TAG);
  });
});

describe('llama thinking-budget probe cache', () => {
  beforeEach(() => {
    helpProbeCalls = 0;
    resetLlamaRuntimeInstallForTests();
  });

  after(() => {
    resetLlamaRuntimeInstallForTests();
  });

  test('runProcess --help runs once per binary path then serves the cache', async () => {
    const first = await detectLlamaThinkingBudgetSupport('/fake/llama-server');
    const second = await detectLlamaThinkingBudgetSupport('/fake/llama-server');
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(helpProbeCalls, 1);

    const other = await detectLlamaThinkingBudgetSupport('/other/llama-server');
    assert.equal(other, true);
    assert.equal(helpProbeCalls, 2);
  });

  test('resetLlamaRuntimeInstallForTests clears the probe cache', async () => {
    await detectLlamaThinkingBudgetSupport('/fake/llama-server');
    assert.equal(helpProbeCalls, 1);
    resetLlamaRuntimeInstallForTests();
    await detectLlamaThinkingBudgetSupport('/fake/llama-server');
    assert.equal(helpProbeCalls, 2);
  });
});
});
