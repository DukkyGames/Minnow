import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  clearGgufMetadataCache,
  parseGgufHeader,
  readGgufMetadata,
} from '../../server/models/gguf-metadata.js';

const TYPE = { UINT32: 4, STRING: 8, ARRAY: 9, BOOL: 7 };
/** ggml type ids used below. */
const GGML_Q4_K = 12;
const GGML_F32 = 0;

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}

function u64(value) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

function gstring(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(bytes.length), bytes]);
}

function kvU32(key, value) {
  return Buffer.concat([gstring(key), u32(TYPE.UINT32), u32(value)]);
}

function kvString(key, value) {
  return Buffer.concat([gstring(key), u32(TYPE.STRING), gstring(value)]);
}

function kvBoolArray(key, values) {
  const items = Buffer.from(values.map((v) => (v ? 1 : 0)));
  return Buffer.concat([gstring(key), u32(TYPE.ARRAY), u32(TYPE.BOOL), u64(values.length), items]);
}

function kvStringArray(key, values) {
  return Buffer.concat([
    gstring(key),
    u32(TYPE.ARRAY),
    u32(TYPE.STRING),
    u64(values.length),
    ...values.map(gstring),
  ]);
}

function tensor(name, dims, type) {
  return Buffer.concat([
    gstring(name),
    u32(dims.length),
    ...dims.map(u64),
    u32(type),
    u64(0),
  ]);
}

/** Assemble a GGUF v3 header (no weight data — the parser never reads past the index). */
function buildGguf({ kv, tensors }) {
  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(tensors.length),
    u64(kv.length),
    ...kv,
    ...tensors,
  ]);
}

let tmpDir = '';

before(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-gguf-'));
});

after(async () => {
  clearGgufMetadataCache();
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

async function writeGguf(name, spec) {
  const filePath = path.join(tmpDir, name);
  await fsp.writeFile(filePath, buildGguf(spec));
  return filePath;
}

describe('gguf metadata', () => {
  it('reads attention geometry and per-role tensor bytes', async () => {
    const filePath = await writeGguf('llama.gguf', {
      kv: [
        kvString('general.architecture', 'llama'),
        kvU32('llama.block_count', 32),
        kvU32('llama.embedding_length', 4096),
        kvU32('llama.attention.head_count', 32),
        kvU32('llama.attention.head_count_kv', 8),
        kvU32('llama.context_length', 131072),
        // Long string arrays must be walked without being collected.
        kvStringArray('tokenizer.ggml.tokens', ['a', 'b', 'c']),
      ],
      tensors: [
        tensor('token_embd.weight', [4096, 128256], GGML_Q4_K),
        tensor('output_norm.weight', [4096], GGML_F32),
        tensor('blk.0.attn_q.weight', [4096, 4096], GGML_Q4_K),
      ],
    });

    const meta = await parseGgufHeader(filePath);
    assert.equal(meta.arch, 'llama');
    assert.equal(meta.nLayers, 32);
    assert.equal(meta.nKvHeads, 8);
    // No key_length in the header, so head size falls out of embedding / head count.
    assert.equal(meta.headDim, 128);
    assert.equal(meta.nVocab, 128256);
    assert.equal(meta.splitCount, 1);

    // Q4_K packs 256 elements into 144 bytes.
    assert.equal(meta.layerBytes, ((4096 * 4096) / 256) * 144);
    assert.equal(meta.fixedBytes, ((4096 * 128256) / 256) * 144 + 4096 * 4);
  });

  it('prefers an explicit key_length over embedding / head count', async () => {
    const filePath = await writeGguf('keylen.gguf', {
      kv: [
        kvString('general.architecture', 'gemma3'),
        kvU32('gemma3.block_count', 48),
        kvU32('gemma3.embedding_length', 3840),
        kvU32('gemma3.attention.head_count', 16),
        kvU32('gemma3.attention.head_count_kv', 8),
        kvU32('gemma3.attention.key_length', 256),
      ],
      tensors: [],
    });

    const meta = await parseGgufHeader(filePath);
    assert.equal(meta.headDim, 256);
  });

  it('reads a per-layer sliding-window pattern as an exact full-attention count', async () => {
    // 6 blocks, every third one full attention: [swa, swa, full, swa, swa, full].
    const filePath = await writeGguf('swa.gguf', {
      kv: [
        kvString('general.architecture', 'gemma4'),
        kvU32('gemma4.block_count', 6),
        kvU32('gemma4.embedding_length', 2816),
        kvU32('gemma4.attention.head_count', 16),
        kvU32('gemma4.attention.head_count_kv', 8),
        kvU32('gemma4.attention.key_length', 512),
        kvU32('gemma4.attention.key_length_swa', 256),
        kvU32('gemma4.attention.sliding_window', 1024),
        kvBoolArray('gemma4.attention.sliding_window_pattern', [
          true,
          true,
          false,
          true,
          true,
          false,
        ]),
      ],
      tensors: [],
    });

    const meta = await parseGgufHeader(filePath);
    assert.equal(meta.nFullAttentionLayers, 2);
    assert.equal(meta.swaWindow, 1024);
    assert.equal(meta.swaHeadDim, 256);
  });

  it('reads a scalar sliding-window pattern as a period', async () => {
    const filePath = await writeGguf('swa-scalar.gguf', {
      kv: [
        kvString('general.architecture', 'gemma3'),
        kvU32('gemma3.block_count', 48),
        kvU32('gemma3.embedding_length', 3840),
        kvU32('gemma3.attention.head_count', 16),
        kvU32('gemma3.attention.head_count_kv', 8),
        kvU32('gemma3.attention.sliding_window', 1024),
        kvU32('gemma3.attention.sliding_window_pattern', 6),
      ],
      tensors: [],
    });

    const meta = await parseGgufHeader(filePath);
    assert.equal(meta.swaPeriod, 6);
    assert.equal(meta.nFullAttentionLayers, 0);
  });

  it('returns null for a file that is not GGUF instead of throwing', async () => {
    const filePath = path.join(tmpDir, 'junk.gguf');
    await fsp.writeFile(filePath, Buffer.from('not a model at all', 'utf8'));
    assert.equal(await readGgufMetadata(filePath), null);
  });

  it('returns null for a missing path and for non-gguf suffixes', async () => {
    assert.equal(await readGgufMetadata(path.join(tmpDir, 'nope.gguf')), null);
    assert.equal(await readGgufMetadata(path.join(tmpDir, 'llama.safetensors')), null);
  });

  it('memoizes on path, size, and mtime', async () => {
    const filePath = path.join(tmpDir, 'llama.gguf');
    const first = await readGgufMetadata(filePath);
    const second = await readGgufMetadata(filePath);
    assert.ok(first);
    assert.equal(first, second);
  });
});
