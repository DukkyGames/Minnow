/**
 * llama.cpp variant asset resolution tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  expectedAssetNames,
  listInstallableVariants,
  resolveLlamaAssets,
  isGpuCapableVariant,
} from '../../server/models/llama-variant.js';
import { LLAMA_CPP_RELEASE_TAG } from '../../server/models/llama-runtime.js';

const MOCK_ASSETS = [
  { name: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-win-cpu-x64.zip` },
  { name: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-win-cuda-12.4-x64.zip` },
  { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip' },
  { name: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-win-vulkan-x64.zip` },
];

describe('llama variant', () => {
  test('expectedAssetNames returns CPU asset on Windows x64', () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') return;
    const names = expectedAssetNames('cpu', LLAMA_CPP_RELEASE_TAG);
    assert.equal(names.main, `llama-${LLAMA_CPP_RELEASE_TAG}-bin-win-cpu-x64.zip`);
  });

  test('resolveLlamaAssets picks CUDA main + cudart companion on Windows', () => {
    if (process.platform !== 'win32') return;
    const resolved = resolveLlamaAssets({
      variant: 'cuda-12.4',
      tag: LLAMA_CPP_RELEASE_TAG,
      assets: MOCK_ASSETS,
    });
    assert.match(resolved.mainZip, /cuda-12\.4/);
    assert.ok(resolved.companionZip?.startsWith('cudart-'));
    assert.equal(resolved.assetNames.length, 2);
  });

  test('listInstallableVariants filters by manifest', () => {
    const variants = listInstallableVariants(MOCK_ASSETS);
    assert.ok(variants.includes('cpu'));
    if (process.platform === 'win32') {
      assert.ok(variants.includes('cuda-12.4'));
      assert.ok(variants.includes('vulkan'));
    }
  });

  test('isGpuCapableVariant distinguishes CPU from CUDA', () => {
    assert.equal(isGpuCapableVariant('cpu'), false);
    assert.equal(isGpuCapableVariant('cuda-12.4'), true);
  });
});
