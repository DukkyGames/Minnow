/**
 * Fingerprint TypeScript project inputs that tsserver often does not reload
 * while a document stays open (tsconfig*.json, jsconfig.json, package.json,
 * and @types/node). Used so agent `get_lsp_diagnostics` does not keep a stale
 * "Cannot find name 'process'" on vite.config.ts after types or Node tsconfig
 * land (MIN-616).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Config basenames that change which program tsserver uses for a file. */
const PROJECT_CONFIG_NAME_RE = /^(tsconfig(?:\.[^/\\]+)?\.json|jsconfig\.json|package\.json)$/i;

/** Stop walking after this many parents (workspace root is the usual stop). */
const MAX_WALK_DEPTH = 64;

/** Relative paths whose presence/mtime affect Node globals like `process`. */
const TYPE_ROOT_RELS = ['node_modules/@types', 'node_modules/@types/node'];

/**
 * Whether a directory entry is a TypeScript/JS project config we should hash.
 * @param {string} name
 */
export function isTypeScriptProjectConfigName(name) {
  return PROJECT_CONFIG_NAME_RE.test(String(name ?? ''));
}

/**
 * Hash a list of stable string parts into a hex digest.
 * @param {string[]} parts
 */
function fingerprintHash(parts) {
  return createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');
}

/**
 * Stat a path into a stable token. Missing files are part of the fingerprint
 * so installing @types/node after a first diagnostic pass is a cache miss.
 * @param {string} absPath
 */
async function statToken(absPath) {
  try {
    const st = await fs.stat(absPath);
    return `${absPath}|${st.mtimeMs}|${st.ino}|${st.size}`;
  } catch {
    return `${absPath}|missing`;
  }
}

/**
 * Hash tsconfig / jsconfig / package.json plus @types/node along the path from
 * `relativePath` up to `workspaceRoot`. Callers compare this to the last value
 * seen by the agent TypeScript server and bounce tsserver on change.
 *
 * @param {string} relativePath - Project-relative file being diagnosed.
 * @param {string} workspaceRoot
 * @returns {Promise<string>}
 */
export async function hashTypeScriptProjectFingerprint(relativePath, workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const absFile = path.resolve(root, relativePath);
  const parts = [];
  let dir = path.dirname(absFile);

  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      names = [];
    }

    // Hash configs in name order so the digest does not depend on readdir order.
    const configNames = names.filter((name) => isTypeScriptProjectConfigName(name)).sort();
    for (const name of configNames) {
      const abs = path.join(dir, name);
      try {
        const text = await fs.readFile(abs, 'utf8');
        parts.push(abs, text);
      } catch {
        parts.push(abs, 'unreadable');
      }
    }

    for (const rel of TYPE_ROOT_RELS) {
      parts.push(await statToken(path.join(dir, rel)));
    }

    if (path.resolve(dir) === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return fingerprintHash(parts);
}
