/**
 * Extra model folder layout — flat dirs and LM Studio publisher/model nesting.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { writeConfigJson } from '../../server/config/store.js';
import { listCachedModels } from '../../server/models/cached.js';
import { customArtifactRepoId, scanInstalledArtifacts } from '../../server/models/installed.js';

describe('custom model dirs (LM Studio layout)', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelsRoot;
  /** @type {string | undefined} */
  let prevHome;

  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-custom-dirs-'));
    modelsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-models-root-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();

    const flatDir = path.join(modelsRoot, 'local-llama');
    await fsp.mkdir(flatDir, { recursive: true });
    await fsp.writeFile(path.join(flatDir, 'model-Q8_0.gguf'), Buffer.alloc(64));

    const nestedModel = path.join(modelsRoot, 'lmstudio-community', 'Qwen3.5-9B-GGUF');
    await fsp.mkdir(nestedModel, { recursive: true });
    await fsp.writeFile(path.join(nestedModel, 'Qwen3.5-9B-Q8_0.gguf'), Buffer.alloc(128));
    await fsp.writeFile(path.join(nestedModel, 'mmproj-Qwen3.5-9B-BF16.gguf'), Buffer.alloc(32));

    await writeConfigJson('config.json', {
      models: {
        modelDirs: [modelsRoot],
      },
    });
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fsp.rm(modelsRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('customArtifactRepoId distinguishes flat vs nested folders', () => {
    const publisher = path.join(modelsRoot, 'lmstudio-community');
    const nested = path.join(publisher, 'Qwen3.5-9B-GGUF', 'Qwen3.5-9B-Q8_0.gguf');
    assert.equal(
      customArtifactRepoId('lmstudio-community', publisher, nested),
      'lmstudio-community/Qwen3.5-9B-GGUF',
    );

    const flat = path.join(modelsRoot, 'local-llama', 'model-Q8_0.gguf');
    assert.equal(customArtifactRepoId('local-llama', path.join(modelsRoot, 'local-llama'), flat), 'local-llama');
  });

  test('scanInstalledArtifacts groups nested LM Studio weights under publisher/model', async () => {
    const artifacts = await scanInstalledArtifacts();
    const nested = artifacts.filter((a) => a.repoId === 'lmstudio-community/Qwen3.5-9B-GGUF');
    assert.equal(nested.length, 2, 'expected model + projector GGUF files');
    assert.ok(artifacts.some((a) => a.repoId === 'local-llama'));
  });

  test('listCachedModels surfaces each nested model with resolvable paths', async () => {
    const { models } = await listCachedModels();
    const row = models.find((m) => m.repo_id === 'lmstudio-community/Qwen3.5-9B-GGUF');
    assert.ok(row?.is_local_dir, 'expected local-dir row');
    const modelFile = row?.gguf_files?.find((f) => f.role === 'model');
    assert.ok(modelFile, 'expected a model GGUF entry');
    const abs = path.join(row.path, modelFile.rel_path);
    await fsp.access(abs);
  });
});
