/**
 * MLX repo detection — what counts as MLX weights on disk, and what must not.
 *
 * The discrimination is the whole point: `config.json` + `*.safetensors`
 * describes every transformers repo ever published, so a loose heuristic turns
 * a cached fp16 Llama into a servable "MLX" row that fails at load.
 *
 * Negative controls live in the Hugging Face cache rather than Minnow's own
 * artifacts directory, because that is where a plain transformers repo actually
 * turns up — Minnow only ever downloads GGUF or MLX into artifacts.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { listCachedModels } from '../../server/models/cached.js';

/** @type {string} */
let homeDir;
/** @type {string | undefined} */
let prevHome;
/** @type {string | undefined} */
let prevHfHome;
/** @type {string | undefined} */
let prevHubCache;
/** @type {Map<string, any>} */
let rows;

/**
 * Write a repo into the HF hub cache layout (models--org--name/snapshots/sha).
 * @param {string} repoId
 * @param {object} config
 * @param {{ safetensors?: boolean }} [layout]
 */
async function writeCachedRepo(repoId, config, layout = {}) {
  const dir = path.join(
    homeDir,
    'hf',
    'hub',
    `models--${repoId.replace(/\//g, '--')}`,
    'snapshots',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  );
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  if (layout.safetensors !== false) {
    await fsp.writeFile(path.join(dir, 'model.safetensors'), Buffer.alloc(2048));
  }
  await fsp.writeFile(path.join(dir, 'tokenizer_config.json'), '{}');
  return dir;
}

/**
 * Write a repo into Minnow's own artifacts directory (a completed download).
 * @param {string} repoId
 * @param {object} config
 */
async function writeArtifactRepo(repoId, config) {
  const dir = path.join(homeDir, 'models', 'artifacts', repoId.replace(/\//g, '--'));
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  await fsp.writeFile(path.join(dir, 'model.safetensors'), Buffer.alloc(2048));
  await fsp.writeFile(path.join(dir, 'tokenizer_config.json'), '{}');
  return dir;
}

describe('MLX repo detection', () => {
  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    prevHfHome = process.env.HF_HOME;
    prevHubCache = process.env.HUGGINGFACE_HUB_CACHE;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-detect-'));
    process.env.MINNOW_HOME = homeDir;
    // Isolate the cache scan from whatever this machine actually has cached.
    process.env.HF_HOME = path.join(homeDir, 'hf');
    delete process.env.HUGGINGFACE_HUB_CACHE;
    resetMinnowHomeCache();

    // What mlx_lm.convert writes: a top-level `quantization` block. Single
    // shard, so there is deliberately no model.safetensors.index.json.
    await writeCachedRepo('mlx-community/Qwen3-8B-4bit', {
      model_type: 'qwen3',
      architectures: ['Qwen3ForCausalLM'],
      quantization: { group_size: 64, bits: 4 },
    });

    // What the Hub reports for real MLX repos: a bare `bits` under
    // quantization_config with no quant_method.
    await writeCachedRepo('lmstudio-community/DeepSeek-R1-Qwen3-8B-MLX-8bit', {
      model_type: 'qwen3',
      quantization_config: { bits: 8 },
    });

    // The negative that matters most: an ordinary fp16 transformers repo.
    await writeCachedRepo('meta-llama/Llama-3-8B', {
      model_type: 'llama',
      architectures: ['LlamaForCausalLM'],
      torch_dtype: 'float16',
    });

    // A foreign quantizer. GPTQ/AWQ/bitsandbytes all name themselves here.
    await writeCachedRepo('someorg/Llama-3-8B-GPTQ', {
      model_type: 'llama',
      quantization_config: { bits: 4, quant_method: 'gptq' },
    });

    // Config claims quantization but there are no weights to serve.
    await writeCachedRepo(
      'someorg/config-only',
      { model_type: 'llama', quantization: { group_size: 64, bits: 4 } },
      { safetensors: false },
    );

    // A repo Minnow downloaded itself, which takes the artifacts scan path.
    await writeArtifactRepo('mlx-community/Llama-3.2-3B-4bit', {
      model_type: 'llama',
      quantization: { group_size: 64, bits: 4 },
    });

    const { models } = await listCachedModels();
    rows = new Map(models.map((m) => [m.repo_id, m]));
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    if (prevHfHome === undefined) delete process.env.HF_HOME;
    else process.env.HF_HOME = prevHfHome;
    if (prevHubCache !== undefined) process.env.HUGGINGFACE_HUB_CACHE = prevHubCache;
    resetMinnowHomeCache();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('detects a single-shard quantized MLX repo and reads its bit width', () => {
    const row = rows.get('mlx-community/Qwen3-8B-4bit');
    assert.ok(row, 'expected the MLX repo to be scanned');
    assert.ok(row.mlx_root, 'expected mlx_root to be set');
    assert.equal(row.mlx_quant, 'mlx-4bit');
  });

  test('a single-shard repo has no index.json, and is found anyway', async () => {
    const row = rows.get('mlx-community/Qwen3-8B-4bit');
    // mlx_lm.server's own /v1/models heuristic requires
    // model.safetensors.index.json, which only exists for sharded models. This
    // asserts Minnow does not inherit that blind spot.
    await assert.rejects(() =>
      fsp.access(path.join(row.mlx_root, 'model.safetensors.index.json')),
    );
    assert.ok(row.mlx_root);
  });

  test('reads bits from a bare quantization_config, as the Hub reports it', () => {
    const row = rows.get('lmstudio-community/DeepSeek-R1-Qwen3-8B-MLX-8bit');
    assert.ok(row);
    assert.equal(row.mlx_quant, 'mlx-8bit');
  });

  test('finds MLX repos Minnow downloaded into its artifacts directory', () => {
    const row = rows.get('mlx-community/Llama-3.2-3B-4bit');
    assert.ok(row, 'artifact MLX repos must be scanned despite holding no .gguf');
    assert.ok(row.mlx_root);
    assert.equal(row.mlx_quant, 'mlx-4bit');
  });

  test('a plain transformers repo is NOT flagged as MLX', () => {
    const row = rows.get('meta-llama/Llama-3-8B');
    assert.ok(row, 'the repo should still be scanned, just not as MLX');
    assert.equal(row.mlx_root, undefined);
    assert.equal(row.mlx_quant, undefined);
  });

  test('a GPTQ repo is NOT flagged as MLX', () => {
    const row = rows.get('someorg/Llama-3-8B-GPTQ');
    assert.ok(row);
    assert.equal(row.mlx_root, undefined);
  });

  test('a config without weights is NOT flagged as MLX', () => {
    const row = rows.get('someorg/config-only');
    // Either not scanned at all or scanned without the MLX marker; what must
    // never happen is a servable row pointing at a directory with no weights.
    assert.equal(row?.mlx_root, undefined);
  });
});
