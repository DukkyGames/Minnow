/**
 * Directory listing and file counts for the chats workspace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getChatsWorkspacePath,
  resolveSafeChatsPath,
  toChatsRelativePath,
} from './paths.js';

/**
 * Count regular files under the chats workspace (recursive).
 * @returns {Promise<number>}
 */
export async function countChatsWorkspaceFiles() {
  const root = getChatsWorkspacePath();
  let count = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        count += 1;
      }
    }
  }

  await walk(root);
  return count;
}

/**
 * List one directory under the chats workspace.
 * @param {string | null | undefined} userPath
 * @returns {Promise<{
 *   path: string,
 *   relativePath: string,
 *   parent: string | null,
 *   entries: Array<{ name: string, path: string, relativePath: string, kind: 'file' | 'directory', size?: number }>
 * }>}
 */
export async function listChatsWorkspaceDirectory(userPath) {
  const dirPath = resolveSafeChatsPath(userPath);
  const stat = await fs.stat(dirPath);
  if (!stat.isDirectory()) {
    throw new Error('Path must be a directory');
  }

  const root = getChatsWorkspacePath();
  const relativePath = toChatsRelativePath(dirPath);
  const parentAbs = path.dirname(dirPath);
  const parent =
    isSameChatsPath(parentAbs, dirPath) || !isUnderOrEqualChatsRoot(parentAbs, root)
      ? null
      : toChatsRelativePath(parentAbs);

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries = [];
  for (const ent of dirents) {
    if (ent.name === '.' || ent.name === '..') continue;
    const full = path.join(dirPath, ent.name);
    const rel = toChatsRelativePath(full);
    if (ent.isDirectory()) {
      entries.push({
        name: ent.name,
        path: full,
        relativePath: rel,
        kind: 'directory',
      });
      continue;
    }
    if (ent.isFile()) {
      let size;
      try {
        const fileStat = await fs.stat(full);
        size = fileStat.size;
      } catch {
        size = undefined;
      }
      entries.push({
        name: ent.name,
        path: full,
        relativePath: rel,
        kind: 'file',
        size,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return {
    path: dirPath,
    relativePath,
    parent,
    entries,
  };
}

function isSameChatsPath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function isUnderOrEqualChatsRoot(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
