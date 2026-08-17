/**
 * Split-GGUF filename helpers.
 *
 * llama.cpp `-m` points at shard 00001 and loads `00002..N` from the same
 * directory. Discover used to download only the first matching GGUF, so a
 * `-00001-of-00003` repo looked servable with two shards missing.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

/** `-00001-of-00003.gguf` (zero-padded 5-digit index and count). */
export const SPLIT_GGUF_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

/**
 * @typedef {object} SplitGgufName
 * @property {string} dir Repo-relative directory ('' for a basename).
 * @property {string} prefix Filename up to but not including `-NNNNN-of-NNNNN`.
 * @property {number} index 1-based shard index from the name.
 * @property {number} count Total shards advertised in the name.
 * @property {string} ext `.gguf` preserving original case.
 */

/**
 * Parse a split-GGUF path. Returns null for ordinary single-file names.
 * @param {string} filePath repo-relative or basename
 * @returns {SplitGgufName | null}
 */
export function parseSplitGgufFilename(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const dir = slash >= 0 ? normalized.slice(0, slash) : '';
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const match = name.match(SPLIT_GGUF_RE);
  if (!match || match.index == null) return null;
  return {
    dir,
    prefix: name.slice(0, match.index),
    index: Number(match[1]),
    count: Number(match[2]),
    ext: name.slice(name.lastIndexOf('.')),
  };
}

/**
 * Build `prefix-0000i-of-0000N.ext` (optionally under `dir/`).
 * @param {SplitGgufName} parsed
 * @param {number} index
 * @param {number} [count]
 */
export function splitGgufShardName(parsed, index, count = parsed.count) {
  const name = `${parsed.prefix}-${String(index).padStart(5, '0')}-of-${String(count).padStart(5, '0')}${parsed.ext}`;
  return parsed.dir ? `${parsed.dir}/${name}` : name;
}

/**
 * If `chosen` is a split shard, expand to every `00001..N` sibling and assert
 * the listing contains exactly N of them. Non-split names return `[chosen]`.
 * @param {string} chosen
 * @param {string[]} listedPaths
 * @returns {string[]}
 */
export function expandSplitGgufFilenames(chosen, listedPaths) {
  const parsed = parseSplitGgufFilename(chosen);
  if (!parsed) return [chosen];

  const listed = new Set((listedPaths || []).map((p) => String(p).replace(/\\/g, '/')));
  const expected = [];
  for (let i = 1; i <= parsed.count; i += 1) {
    expected.push(splitGgufShardName(parsed, i));
  }
  const found = expected.filter((p) => listed.has(p));
  if (found.length !== parsed.count) {
    throw new Error(
      `Split GGUF ${chosen} expects ${parsed.count} shards, but the repo lists ${found.length}`,
    );
  }
  return expected;
}

/**
 * Refuse to serve a split model when `00002..splitCount` are missing beside
 * shard 1. No-ops when splitCount ≤ 1 (single-file models and unknown headers).
 * @param {string} modelPath Absolute path passed as llama.cpp `-m` (shard 1).
 * @param {number} splitCount From GGUF `split.count`.
 */
export async function assertSplitGgufSiblings(modelPath, splitCount) {
  const n = Number(splitCount);
  if (!Number.isFinite(n) || n <= 1) return;

  const base = path.basename(modelPath);
  const parsed = parseSplitGgufFilename(base);
  if (!parsed) {
    throw new Error(
      `Split GGUF (${n} shards) needs a -00001-of-${String(n).padStart(5, '0')}.gguf filename; got ${base}`,
    );
  }
  if (parsed.index !== 1) {
    throw new Error(`llama.cpp -m must point at shard 00001, not ${base}`);
  }

  const dir = path.dirname(modelPath);
  /** @type {string[]} */
  const missing = [];
  for (let i = 2; i <= n; i += 1) {
    const sibling = splitGgufShardName({ ...parsed, dir: '' }, i, n);
    try {
      const stat = await fsp.stat(path.join(dir, sibling));
      if (!stat.isFile()) missing.push(sibling);
    } catch {
      missing.push(sibling);
    }
  }
  if (missing.length) {
    throw new Error(
      `Split GGUF is missing ${missing.join(', ')} next to ${base}`,
    );
  }
}
