/**
 * Read attention geometry straight out of a GGUF file's header.
 *
 * For weights that are already on disk there is no reason to guess: the header states the
 * block count, GQA width, head size, and every tensor's exact type and shape. That turns the
 * Load tab's memory estimate from a heuristic into arithmetic, and gives the GPU-layers
 * slider a real maximum instead of a bucket fitted to parameter count.
 *
 * Only the header is read — the KV block plus the tensor index, typically a few MB — never
 * the weights themselves.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

const GGUF_MAGIC = 0x46554747; // "GGUF" little-endian

/** Stop growing the header buffer past this; a real header never approaches it. */
const MAX_HEADER_BYTES = 64 * 1024 * 1024;
const INITIAL_READ_BYTES = 1024 * 1024;

/** GGUF metadata value type tags. */
const VALUE_TYPE = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
};

/**
 * ggml tensor types as `[elementsPerBlock, bytesPerBlock]`, which is what turns a tensor's
 * shape into its size on disk. Indexes match `enum ggml_type`.
 * @type {Record<number, [number, number]>}
 */
const GGML_TYPE_SIZES = {
  0: [1, 4], // F32
  1: [1, 2], // F16
  2: [32, 18], // Q4_0
  3: [32, 20], // Q4_1
  6: [32, 22], // Q5_0
  7: [32, 24], // Q5_1
  8: [32, 34], // Q8_0
  9: [32, 36], // Q8_1
  10: [256, 84], // Q2_K
  11: [256, 110], // Q3_K
  12: [256, 144], // Q4_K
  13: [256, 176], // Q5_K
  14: [256, 210], // Q6_K
  15: [256, 292], // Q8_K
  16: [256, 66], // IQ2_XXS
  17: [256, 74], // IQ2_XS
  18: [256, 98], // IQ3_XXS
  19: [256, 50], // IQ1_S
  20: [32, 18], // IQ4_NL
  21: [256, 110], // IQ3_S
  22: [256, 82], // IQ2_S
  23: [256, 136], // IQ4_XS
  24: [1, 1], // I8
  25: [1, 2], // I16
  26: [1, 4], // I32
  27: [1, 8], // I64
  28: [1, 8], // F64
  29: [256, 56], // IQ1_M
  30: [1, 2], // BF16
  34: [256, 54], // TQ1_0
  35: [256, 66], // TQ2_0
  39: [32, 17], // MXFP4
};

/**
 * Cursor over a GGUF header that pulls more of the file in as the parse advances.
 */
class HeaderReader {
  /** @param {import('node:fs/promises').FileHandle} handle */
  constructor(handle, fileSize) {
    this.handle = handle;
    this.fileSize = fileSize;
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
  }

  /**
   * Guarantee `count` more bytes past the cursor, reading further into the file if needed.
   * @param {number} count
   */
  async ensure(count) {
    const needed = this.offset + count;
    if (needed <= this.buffer.length) return;
    if (needed > MAX_HEADER_BYTES) throw new Error('GGUF header exceeds size limit');

    let target = Math.max(needed, this.buffer.length * 2, INITIAL_READ_BYTES);
    target = Math.min(target, this.fileSize, MAX_HEADER_BYTES);
    if (target <= this.buffer.length) throw new Error('GGUF header truncated');

    const next = Buffer.alloc(target);
    const { bytesRead } = await this.handle.read(next, 0, target, 0);
    if (bytesRead < needed) throw new Error('GGUF header truncated');
    this.buffer = bytesRead === target ? next : next.subarray(0, bytesRead);
  }

  async u8() {
    await this.ensure(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  async u16() {
    await this.ensure(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  async u32() {
    await this.ensure(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  async i32() {
    await this.ensure(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  async f32() {
    await this.ensure(4);
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  async f64() {
    await this.ensure(8);
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  async u64() {
    await this.ensure(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return Number(value);
  }

  async i64() {
    await this.ensure(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return Number(value);
  }

  async string() {
    const length = await this.u64();
    if (length < 0 || length > MAX_HEADER_BYTES) throw new Error('GGUF string length invalid');
    await this.ensure(length);
    const value = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /** Advance past a string without decoding it — used for token vocabularies. */
  async skipString() {
    const length = await this.u64();
    if (length < 0 || length > MAX_HEADER_BYTES) throw new Error('GGUF string length invalid');
    await this.ensure(length);
    this.offset += length;
  }
}

/**
 * @param {HeaderReader} reader
 * @param {number} type
 */
async function readScalar(reader, type) {
  switch (type) {
    case VALUE_TYPE.UINT8:
      return reader.u8();
    case VALUE_TYPE.INT8:
      return (await reader.u8()) << 24 >> 24;
    case VALUE_TYPE.UINT16:
      return reader.u16();
    case VALUE_TYPE.INT16:
      return (await reader.u16()) << 16 >> 16;
    case VALUE_TYPE.UINT32:
      return reader.u32();
    case VALUE_TYPE.INT32:
      return reader.i32();
    case VALUE_TYPE.FLOAT32:
      return reader.f32();
    case VALUE_TYPE.BOOL:
      return (await reader.u8()) !== 0;
    case VALUE_TYPE.STRING:
      return reader.string();
    case VALUE_TYPE.UINT64:
      return reader.u64();
    case VALUE_TYPE.INT64:
      return reader.i64();
    case VALUE_TYPE.FLOAT64:
      return reader.f64();
    default:
      throw new Error(`Unknown GGUF value type ${type}`);
  }
}

/**
 * Read one metadata value.
 *
 * Arrays are walked but not collected past a small prefix: `tokenizer.ggml.tokens` alone
 * holds ~150k strings, and nothing here needs its contents — only its length, which is a
 * usable vocabulary size when the tensor index does not give one.
 * @param {HeaderReader} reader
 * @param {number} type
 */
async function readValue(reader, type) {
  if (type !== VALUE_TYPE.ARRAY) return readScalar(reader, type);

  const itemType = await reader.u32();
  const count = await reader.u64();
  if (count < 0 || count > 1e8) throw new Error('GGUF array length invalid');

  // Per-layer arrays (attention patterns, head counts) run to the block count, so collect
  // anything short enough to be one of those; only vocabularies are longer.
  const collect = count <= 1024 && itemType !== VALUE_TYPE.ARRAY && itemType !== VALUE_TYPE.STRING;
  const items = [];
  for (let i = 0; i < count; i += 1) {
    if (itemType === VALUE_TYPE.STRING) {
      await reader.skipString();
      continue;
    }
    if (itemType === VALUE_TYPE.ARRAY) throw new Error('Nested GGUF arrays are not supported');
    const value = await readScalar(reader, itemType);
    if (collect) items.push(value);
  }
  return collect ? items : { arrayLength: count };
}

/** @param {unknown} value */
function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // `head_count_kv` is per-layer on a few hybrid models; the widest layer sets the cache size.
  if (Array.isArray(value)) {
    const nums = value.filter((v) => typeof v === 'number' && Number.isFinite(v));
    return nums.length ? Math.max(...nums) : 0;
  }
  return 0;
}

/**
 * Full-attention layer count from `{arch}.attention.sliding_window_pattern`.
 *
 * The key comes in two shapes. A scalar N means one full-attention layer every N — llama.cpp's
 * `set_swa_pattern(N)`. An array of booleans is the per-layer map that newer architectures
 * (Gemma 4) ship instead, where `true` marks a layer that *uses* the sliding window. Reading
 * the array form matters: it is the difference between charging a Gemma-class model for 30
 * growing caches and for the 5 it actually keeps.
 * @param {unknown} value
 * @param {number} nLayers
 * @returns {{ swaPeriod: number, fullLayers: number }}
 */
function readSwaPattern(value, nLayers) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { swaPeriod: value, fullLayers: 0 };
  }
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'boolean')) {
    const windowed = value.filter(Boolean).length;
    return { swaPeriod: 0, fullLayers: Math.max(0, Math.min(nLayers, value.length - windowed)) };
  }
  return { swaPeriod: 0, fullLayers: 0 };
}

/**
 * @typedef {object} GgufTensorSummary
 * @property {number} layerBytes Bytes in repeating `blk.*` tensors.
 * @property {number} fixedBytes Bytes in embedding / output / norm tensors.
 * @property {number} nVocab Vocabulary size from the token embedding shape, 0 if absent.
 */

/**
 * Walk the tensor index, totalling bytes per role and picking up the vocabulary size.
 * @param {HeaderReader} reader
 * @param {number} tensorCount
 * @returns {Promise<GgufTensorSummary>}
 */
async function readTensorIndex(reader, tensorCount) {
  let layerBytes = 0;
  let fixedBytes = 0;
  let nVocab = 0;

  for (let i = 0; i < tensorCount; i += 1) {
    const name = await reader.string();
    const nDims = await reader.u32();
    if (nDims > 4) throw new Error('GGUF tensor rank invalid');
    const dims = [];
    for (let d = 0; d < nDims; d += 1) dims.push(await reader.u64());
    const type = await reader.u32();
    await reader.u64(); // data offset

    const elements = dims.reduce((acc, d) => acc * d, 1);
    const [blockSize, blockBytes] = GGML_TYPE_SIZES[type] ?? [1, 4];
    const bytes = (elements / blockSize) * blockBytes;

    if (name.startsWith('blk.')) layerBytes += bytes;
    else fixedBytes += bytes;

    // ggml stores token_embd.weight as [n_embd, n_vocab].
    if (name === 'token_embd.weight' && dims.length >= 2) nVocab = dims[1];
  }

  return { layerBytes, fixedBytes, nVocab };
}

/**
 * @typedef {object} GgufMetadata
 * @property {string} arch
 * @property {number} nLayers
 * @property {number} nHead
 * @property {number} nKvHeads
 * @property {number} headDim
 * @property {number} nEmbd
 * @property {number} nVocab
 * @property {number} nExperts
 * @property {number} swaWindow
 * @property {number} swaPeriod One full-attention layer every N; 0 when not stated as a scalar.
 * @property {number} nFullAttentionLayers Exact count from a per-layer pattern; 0 when absent.
 * @property {number} swaHeadDim Head size on sliding-window layers, when it differs; 0 otherwise.
 * @property {number} trainCtx
 * @property {number} layerBytes
 * @property {number} fixedBytes
 * @property {number} splitCount 1 for a single-file model.
 * @property {number} fileSizeBytes
 */

/**
 * Parse the header of a GGUF file.
 * @param {string} filePath absolute path to a `.gguf` file
 * @returns {Promise<GgufMetadata>}
 */
export async function parseGgufHeader(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const reader = new HeaderReader(handle, stat.size);

    if ((await reader.u32()) !== GGUF_MAGIC) throw new Error('Not a GGUF file');
    const version = await reader.u32();
    if (version < 2 || version > 3) throw new Error(`Unsupported GGUF version ${version}`);

    const tensorCount = await reader.u64();
    const kvCount = await reader.u64();
    if (tensorCount > 1e6 || kvCount > 1e5) throw new Error('GGUF header counts invalid');

    /** @type {Record<string, unknown>} */
    const kv = {};
    for (let i = 0; i < kvCount; i += 1) {
      const key = await reader.string();
      const type = await reader.u32();
      kv[key] = await readValue(reader, type);
    }

    const arch = typeof kv['general.architecture'] === 'string' ? kv['general.architecture'] : '';
    const tensors = await readTensorIndex(reader, tensorCount);

    const nLayers = asNumber(kv[`${arch}.block_count`]);
    const nEmbd = asNumber(kv[`${arch}.embedding_length`]);
    const nHead = asNumber(kv[`${arch}.attention.head_count`]);
    const nKvHeadsRaw = asNumber(kv[`${arch}.attention.head_count_kv`]);
    const nKvHeads = nKvHeadsRaw > 0 ? nKvHeadsRaw : nHead;
    const keyLength = asNumber(kv[`${arch}.attention.key_length`]);
    const headDim = keyLength > 0 ? keyLength : nHead > 0 ? Math.floor(nEmbd / nHead) : 0;
    const swaKeyLength = asNumber(kv[`${arch}.attention.key_length_swa`]);
    const swa = readSwaPattern(kv[`${arch}.attention.sliding_window_pattern`], nLayers);

    const tokens = kv['tokenizer.ggml.tokens'];
    const tokenCount =
      tokens && typeof tokens === 'object' && 'arrayLength' in tokens
        ? Number(tokens.arrayLength)
        : 0;

    return {
      arch,
      nLayers,
      nHead,
      nKvHeads,
      headDim,
      nEmbd,
      nVocab: tensors.nVocab || asNumber(kv[`${arch}.vocab_size`]) || tokenCount,
      nExperts: asNumber(kv[`${arch}.expert_count`]),
      swaWindow: asNumber(kv[`${arch}.attention.sliding_window`]),
      swaPeriod: swa.swaPeriod,
      nFullAttentionLayers: swa.fullLayers,
      swaHeadDim: swaKeyLength,
      trainCtx: asNumber(kv[`${arch}.context_length`]),
      layerBytes: tensors.layerBytes,
      fixedBytes: tensors.fixedBytes,
      splitCount: Math.max(1, asNumber(kv['split.count'])),
      fileSizeBytes: stat.size,
    };
  } finally {
    await handle.close();
  }
}

/** @type {Map<string, GgufMetadata>} */
const cache = new Map();
const CACHE_LIMIT = 64;

/**
 * Parse a GGUF header, memoized on path + size + mtime so reopening the inspector is free.
 * Returns null rather than throwing when the file is missing or not readable as GGUF.
 * @param {string} filePath
 * @returns {Promise<GgufMetadata | null>}
 */
export async function readGgufMetadata(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!resolved.toLowerCase().endsWith('.gguf')) return null;

  let stat;
  try {
    stat = await fsp.stat(resolved);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const key = `${resolved}:${stat.size}:${stat.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let parsed;
  try {
    parsed = await parseGgufHeader(resolved);
  } catch {
    return null;
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, parsed);
  return parsed;
}

/** Test helper — drop memoized headers. */
export function clearGgufMetadataCache() {
  cache.clear();
}
