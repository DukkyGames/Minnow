/**
 * Bundled llama-server runtime — asset selection and installability.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  LLAMA_CPP_RELEASE_TAG,
  copyFlattenedExtractContents,
  isLlamaRuntimeInstallable,
  pickLlamaReleaseAssetName,
} from '../../server/models/llama-runtime.js';

describe('llama runtime', () => {
  test('is installable on supported desktop platforms', () => {
    const supported =
      (process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')) ||
      (process.platform === 'darwin' && (process.arch === 'x64' || process.arch === 'arm64')) ||
      (process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64'));
    assert.equal(isLlamaRuntimeInstallable(), supported);
  });

  test('picks a CPU asset name for the current platform', () => {
    const name = pickLlamaReleaseAssetName(LLAMA_CPP_RELEASE_TAG);
    if (process.platform === 'win32') {
      assert.match(name, /^llama-b\d+-bin-win-cpu-(x64|arm64)\.zip$/);
      return;
    }
    if (process.platform === 'darwin') {
      assert.match(name, /^llama-b\d+-bin-macos-(x64|arm64)\.tar\.gz$/);
      return;
    }
    if (process.platform === 'linux') {
      assert.match(name, /^llama-b\d+-bin-ubuntu-(x64|arm64)\.tar\.gz$/);
      return;
    }
    assert.fail(`unexpected platform ${process.platform}`);
  });

  test('copyFlattenedExtractContents merges cudart-style trees without llama-server', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-llama-test-'));
    const extractDir = path.join(tmp, 'extract');
    const nested = path.join(extractDir, 'cudart-llama-bin-win-cuda-12.4-x64');
    await fsp.mkdir(nested, { recursive: true });
    await fsp.writeFile(path.join(nested, 'cudart64_12.dll'), 'dll', 'utf8');
    const managedRoot = path.join(tmp, 'managed');
    await copyFlattenedExtractContents(extractDir, managedRoot);
    const dll = path.join(managedRoot, 'cudart64_12.dll');
    assert.ok(await fsp.stat(dll));
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
