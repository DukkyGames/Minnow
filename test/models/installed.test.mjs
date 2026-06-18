/**
 * Installed model scan tests — artifacts dir + custom modelDirs.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { writeConfigJson } from '../../server/config/store.js';
import { listInstalled, scanInstalledArtifacts } from '../../server/models/installed.js';

describe('installed model scan', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let customModelsDir;
  /** @type {string | undefined} */
  let prevHome;

  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-installed-'));
    customModelsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-custom-models-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();

    const repoDir = path.join(homeDir, 'models', 'artifacts', 'org--demo');
    await fsp.mkdir(repoDir, { recursive: true });
    await fsp.writeFile(path.join(repoDir, 'artifact-Q4_K_M.gguf'), Buffer.alloc(512));

    const localModelDir = path.join(customModelsDir, 'local-llama');
    await fsp.mkdir(localModelDir, { recursive: true });
    await fsp.writeFile(path.join(localModelDir, 'model-Q8_0.gguf'), Buffer.alloc(768));

    await writeConfigJson('config.json', {
      models: {
        modelDirs: [customModelsDir],
      },
    });
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fsp.rm(customModelsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('finds Minnow artifact downloads', async () => {
    const artifacts = await scanInstalledArtifacts();
    const hit = artifacts.find((a) => a.repoId === 'org/demo' && a.filename === 'artifact-Q4_K_M.gguf');
    assert.ok(hit, 'expected org/demo artifact');
    assert.equal(hit.sizeBytes, 512);
  });

  test('finds GGUF files from config.models.modelDirs', async () => {
    const artifacts = await scanInstalledArtifacts();
    const hit = artifacts.find((a) => a.repoId === 'local-llama' && a.filename === 'model-Q8_0.gguf');
    assert.ok(hit, 'expected local-llama custom dir artifact');
    assert.equal(hit.sizeBytes, 768);
  });

  test('dedupes artifacts by absolute path', async () => {
    const artifacts = await scanInstalledArtifacts();
    const paths = artifacts.map((a) => path.resolve(a.path));
    assert.equal(new Set(paths).size, paths.length, 'expected unique artifact paths');
  });

  test('listInstalled includes custom dir artifacts and downloads array', async () => {
    const payload = await listInstalled();
    assert.ok(Array.isArray(payload.downloads));
    assert.ok(
      payload.artifacts.some((a) => a.repoId === 'local-llama'),
      'listInstalled should surface custom modelDirs',
    );
  });
});
