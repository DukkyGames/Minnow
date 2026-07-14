/**
 * Read GGUF file headers for block counts, architecture, and parameter totals.
 * Parses only metadata KV pairs — does not load tensors.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';

/** GGUF value type ids from the spec. */
const GGUF_TYPE = {
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
 * @typedef {object} GgufMeta
 * @property {string | null} architecture
 * @property {number | null} blockCount
 * @property {number | null} parameterCount
 * @property {number | null} contextLength
 * @property {number} fileSizeBytes
 */

/**
 * @param {Buffer} buf
 * @param {number} offset
 */
function readU32(buf, offset) {
  return buf.readUInt32LE(offset);
}

/**
 * @param {Buffer} buf
 * @param {number} offset
 */
function readU64(buf, offset) {
  return Number(buf.readBigUInt64LE(offset));
}

/**
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {{ value: unknown, next: number }}
 */
function readGgufValue(buf, offset, typeId) {
  switch (typeId) {
    case GGUF_TYPE.UINT8:
      return { value: buf.readUInt8(offset), next: offset + 1 };
    case GGUF_TYPE.INT8:
      return { value: buf.readInt8(offset), next: offset + 1 };
    case GGUF_TYPE.UINT16:
      return { value: buf.readUInt16LE(offset), next: offset + 2 };
    case GGUF_TYPE.INT16:
      return { value: buf.readInt16LE(offset), next: offset + 2 };
    case GGUF_TYPE.UINT32:
    case GGUF_TYPE.INT32:
      return { value: readU32(buf, offset), next: offset + 4 };
    case GGUF_TYPE.FLOAT32:
      return { value: buf.readFloatLE(offset), next: offset + 4 };
    case GGUF_TYPE.BOOL:
      return { value: buf.readUInt8(offset) !== 0, next: offset + 1 };
    case GGUF_TYPE.STRING: {
      const len = readU64(buf, offset);
      const start = offset + 8;
      const value = buf.toString('utf8', start, start + len);
      return { value, next: start + len };
    }
    case GGUF_TYPE.UINT64:
    case GGUF_TYPE.INT64:
      return { value: readU64(buf, offset), next: offset + 8 };
    case GGUF_TYPE.FLOAT64:
      return { value: buf.readDoubleLE(offset), next: offset + 8 };
    case GGUF_TYPE.ARRAY: {
      const elemType = readU32(buf, offset);
      const count = readU64(buf, offset + 4);
      let cursor = offset + 12;
      /** @type {unknown[]} */
      const items = [];
      for (let i = 0; i < count; i++) {
        const item = readGgufValue(buf, cursor, elemType);
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`Unsupported GGUF value type ${typeId}`);
  }
}

/**
 * Parse GGUF metadata from a file path (reads first 256 KiB).
 * @param {string} filePath
 * @returns {Promise<GgufMeta | null>}
 */
export async function readGgufMeta(filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const fd = await fsp.open(filePath, 'r');
  try {
    const toRead = Math.min(stat.size, 256 * 1024);
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fd.read(buf, 0, toRead, 0);
    if (bytesRead < 24) return null;

    const magic = buf.toString('utf8', 0, 4);
    if (magic !== 'GGUF') return null;

    const kvCount = readU64(buf, 16);
    let offset = 24;

    /** @type {Record<string, unknown>} */
    const meta = {};

    for (let i = 0; i < kvCount && offset < bytesRead - 8; i++) {
      const keyLen = readU64(buf, offset);
      offset += 8;
      if (offset + keyLen > bytesRead) break;
      const key = buf.toString('utf8', offset, offset + keyLen);
      offset += keyLen;
      if (offset + 4 > bytesRead) break;
      const typeId = readU32(buf, offset);
      offset += 4;
      const parsed = readGgufValue(buf, offset, typeId);
      meta[key] = parsed.value;
      offset = parsed.next;
    }

    const architecture =
      typeof meta['general.architecture'] === 'string' ? meta['general.architecture'] : null;

    let blockCount = null;
    if (architecture) {
      const blockKey = `${architecture}.block_count`;
      const raw = meta[blockKey];
      if (typeof raw === 'number') blockCount = raw;
      else if (typeof raw === 'bigint') blockCount = Number(raw);
    }
    if (blockCount == null) {
      for (const [key, value] of Object.entries(meta)) {
        if (key.endsWith('.block_count') && typeof value === 'number') {
          blockCount = value;
          break;
        }
      }
    }

    let parameterCount = null;
    const paramRaw = meta['general.parameter_count'];
    if (typeof paramRaw === 'number') parameterCount = paramRaw;
    else if (typeof paramRaw === 'bigint') parameterCount = Number(paramRaw);

    let contextLength = null;
    const ctxRaw = meta['llama.context_length'] ?? meta[`${architecture}.context_length`];
    if (typeof ctxRaw === 'number') contextLength = ctxRaw;

    return {
      architecture,
      blockCount,
      parameterCount,
      contextLength,
      fileSizeBytes: stat.size,
    };
  } catch {
    return null;
  } finally {
    await fd.close();
  }
}

/**
 * Derive on-disk weights size in GB from file size.
 * @param {GgufMeta} meta
 */
export function ggufWeightsGb(meta) {
  return Math.round((meta.fileSizeBytes / 1e9) * 100) / 100;
}
