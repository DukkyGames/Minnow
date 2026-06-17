/**
 * Voice provisioner — torch variant selection for CPU vs CUDA hosts.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildTorchPackage,
  isCudaHardware,
  patchQwenTtsCheckModelInputsInVenv,
  resolveQwenTtsPackageDir,
} from '../../server/voice/provision.js';
import { getVoiceVenvDir } from '../../server/voice/paths.js';

describe('voice provision torch packages', () => {
  test('buildTorchPackage selects CUDA wheels when CUDA hardware is present', () => {
    const pkg = buildTorchPackage(true);
    assert.equal(pkg.variant, 'cuda');
    assert.match(pkg.label, /CUDA/);
    assert.ok(pkg.args.includes('torch'));
    assert.ok(pkg.args.includes('torchaudio'));
    assert.ok(pkg.args.includes('https://download.pytorch.org/whl/cu124'));
  });

  test('buildTorchPackage selects CPU wheels on CPU-only hosts', () => {
    const pkg = buildTorchPackage(false);
    assert.equal(pkg.variant, 'cpu');
    assert.match(pkg.label, /CPU/);
    assert.ok(pkg.args.includes('torch'));
    assert.ok(pkg.args.includes('torchaudio'));
    assert.ok(pkg.args.includes('https://download.pytorch.org/whl/cpu'));
  });

  test('isCudaHardware reads backend from hardware snapshot', () => {
    assert.equal(isCudaHardware({ backend: 'cuda' }), true);
    assert.equal(isCudaHardware({ backend: 'cpu_x86' }), false);
    assert.equal(isCudaHardware(null), false);
  });

  test('resolveQwenTtsPackageDir finds qwen_tts when voice venv is installed', () => {
    const venvDir = getVoiceVenvDir();
    const pkgDir = resolveQwenTtsPackageDir(venvDir);
    if (!pkgDir) return;
    assert.match(pkgDir.replace(/\\/g, '/'), /qwen_tts$/);
  });

  test('patchQwenTtsCheckModelInputsInVenv is idempotent', async () => {
    const venvDir = getVoiceVenvDir();
    const pkgDir = resolveQwenTtsPackageDir(venvDir);
    if (!pkgDir) return;
    const first = await patchQwenTtsCheckModelInputsInVenv(venvDir);
    const second = await patchQwenTtsCheckModelInputsInVenv(venvDir);
    assert.equal(second, 0);
    assert.ok(first >= 0);
  });
});
