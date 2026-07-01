/**
 * Voice provisioner — torch variant selection for CPU vs CUDA hosts.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  buildTorchPackage,
  isCudaHardware,
  patchQwenTtsCheckModelInputsInVenv,
  patchQwenTtsPadTokenIdInVenv,
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

  test('patchQwenTtsCheckModelInputsInVenv restores decorator call form for transformers 4.57.3', async () => {
    const venvDir = await mkdtemp(join(tmpdir(), 'minnow-voice-patch-'));
    const pkgDir = join(venvDir, 'Lib', 'site-packages', 'qwen_tts');
    const pyPath = join(pkgDir, 'sample.py');
    await mkdir(pkgDir, { recursive: true });
    const source = [
      'from transformers.utils.generic import check_model_inputs',
      '',
      'class Demo:',
      '    @check_model_inputs',
      '    def forward(self):',
      '        pass',
      '',
    ].join('\n');
    await writeFile(pyPath, source, 'utf8');

    try {
      const patched = await patchQwenTtsCheckModelInputsInVenv(venvDir);
      assert.equal(patched, 1);
      const text = await readFile(pyPath, 'utf8');
      assert.match(text, /@check_model_inputs\(\)/);
      assert.doesNotMatch(text, /@check_model_inputs\n/);
    } finally {
      await rm(venvDir, { recursive: true, force: true });
    }
  });

  test('patchQwenTtsPadTokenIdInVenv rewrites padding_idx access for transformers 5.x', async () => {
    const venvDir = await mkdtemp(join(tmpdir(), 'minnow-voice-pad-patch-'));
    const modelsDir = join(venvDir, 'Lib', 'site-packages', 'qwen_tts', 'core', 'models');
    const pyPath = join(modelsDir, 'modeling_qwen3_tts.py');
    await mkdir(modelsDir, { recursive: true });
    const source = [
      'class Demo:',
      '    def __init__(self, config):',
      '        self.padding_idx = config.pad_token_id',
      '        self.padding_idx = config.pad_token_id',
      '',
    ].join('\n');
    await writeFile(pyPath, source, 'utf8');

    try {
      const patched = await patchQwenTtsPadTokenIdInVenv(venvDir);
      assert.equal(patched, 1);
      const text = await readFile(pyPath, 'utf8');
      assert.equal(
        (text.match(/getattr\(config, "pad_token_id", None\)/g) ?? []).length,
        2,
      );
      assert.doesNotMatch(text, /config\.pad_token_id/);
      const second = await patchQwenTtsPadTokenIdInVenv(venvDir);
      assert.equal(second, 0);
    } finally {
      await rm(venvDir, { recursive: true, force: true });
    }
  });
});
