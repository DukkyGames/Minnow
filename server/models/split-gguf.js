import fsp from 'node:fs/promises';
import path from 'node:path';

export const SPLIT_GGUF_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

/**
 * @typedef {object} SplitGgufName
 * @property {string} dir
 * @property {string} prefix
 * @property {number} index
 * @property {number} count
 * @property {string} ext
 */

/**
 * @param {string} filePath
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
 * @param {SplitGgufName} parsed
 * @param {number} index
 * @param {number} [count]
 */
export function splitGgufShardName(parsed, index, count = parsed.count) {
  const name = `${parsed.prefix}-${String(index).padStart(5, '0')}-of-${String(count).padStart(5, '0')}${parsed.ext}`;
  return parsed.dir ? `${parsed.dir}/${name}` : name;
}

/**
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
 * @param {string} modelPath
 * @param {number} splitCount
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
