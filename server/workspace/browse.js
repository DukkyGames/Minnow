/**
 * Directory listing for the in-app workspace folder picker (no native dialog).
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Parent path for "Up", or null at a filesystem root.
 * @param {string} resolved
 * @returns {string | null}
 */
function parentDirectory(resolved) {
  const parent = path.dirname(resolved);
  if (parent === resolved) {
    return null;
  }
  return parent;
}

/**
 * Quick existence check for Windows drive letters (A:\ … Z:\).
 * @returns {Array<{ name: string, path: string }>}
 */
async function listWindowsDriveRoots() {
  if (process.platform !== 'win32') {
    return [];
  }
  const entries = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const driveRoot = `${letter}:\\`;
    try {
      await fs.access(driveRoot);
      entries.push({ name: `${letter}:`, path: driveRoot });
    } catch {
      /* drive not present */
    }
  }
  return entries;
}

/**
 * Top-level locations when no path is provided (home + OS roots).
 * @returns {Promise<Array<{ name: string, path: string }>>}
 */
async function listBrowseRoots() {
  const home = os.homedir();
  const entries = [{ name: 'Home', path: home }];
  if (process.platform === 'win32') {
    const drives = await listWindowsDriveRoots();
    entries.push(...drives);
  } else {
    entries.push({ name: 'Root', path: '/' });
  }
  return entries;
}

/**
 * List child directories of a resolved path (names only, sorted).
 * @param {string} resolved
 * @returns {Promise<Array<{ name: string, path: string }>>}
 */
async function listChildDirectories(resolved) {
  const dirents = await fs.readdir(resolved, { withFileTypes: true });
  const dirs = [];
  for (const ent of dirents) {
    if (!ent.isDirectory()) {
      continue;
    }
    if (ent.name === '.' || ent.name === '..') {
      continue;
    }
    dirs.push({
      name: ent.name,
      path: path.join(resolved, ent.name),
    });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return dirs;
}

/**
 * @param {string | null | undefined} userPath Empty or omitted → roots; otherwise list that folder.
 * @returns {Promise<{ path: string, parent: string | null, entries: Array<{ name: string, path: string }> }>}
 */
export async function browseWorkspaceFolders(userPath) {
  const trimmed = typeof userPath === 'string' ? userPath.trim() : '';
  if (!trimmed) {
    return {
      path: '',
      parent: null,
      entries: await listBrowseRoots(),
    };
  }

  const resolved = path.resolve(trimmed);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Folder does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error('Path must be a directory');
  }

  return {
    path: resolved,
    parent: parentDirectory(resolved),
    entries: await listChildDirectories(resolved),
  };
}
