/**
 * GGUF header metadata reader.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ggufWeightsGb, readGgufMeta } from '../../server/models/gguf-meta.js';

/**
 * Build a minimal GGUF v2 file with architecture + block_count metadata.
 */
function buildMinimalGguf() {
  const parts = [];
  const pushU32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    parts.push(b);
  };
  const pushU64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n), 0);
    parts.push(b);
  };
  const pushString = (s) => {
    const bytes = Buffer.from(s, 'utf8');
    pushU64(bytes.length);
    parts.push(bytes);
  };

  parts.push(Buffer.from('GGUF', 'utf8'));
  pushU32(2); // version
  pushU64(0); // tensor count
  pushU64(2); // kv count

  // general.architecture = "llama" (string type 8)
  pushString('general.architecture');
  pushU32(8);
  pushString('llama');

  // llama.block_count = 32 (uint32 type 4)
  pushString('llama.block_count');
  pushU32(4);
  pushU32(32);

  return Buffer.concat(parts);
}

describe('gguf-meta', () => {
  /** @type {string} */
  let ggufPath;

  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-gguf-meta-'));
    ggufPath = path.join(dir, 'tiny.gguf');
    await fs.writeFile(ggufPath, buildMinimalGguf());
  });

  after(async () => {
    await fs.rm(path.dirname(ggufPath), { recursive: true, force: true });
  });

  test('readGgufMeta extracts architecture and block count', async () => {
    const meta = await readGgufMeta(ggufPath);
    assert.ok(meta);
    assert.equal(meta.architecture, 'llama');
    assert.equal(meta.blockCount, 32);
    assert.ok(meta.fileSizeBytes > 0);
    assert.ok(ggufWeightsGb(meta) >= 0);
  });

  test('readGgufMeta returns null for non-gguf files', async () => {
    const badPath = path.join(path.dirname(ggufPath), 'not.gguf');
    await fs.writeFile(badPath, 'not gguf');
    const meta = await readGgufMeta(badPath);
    assert.equal(meta, null);
  });
});
