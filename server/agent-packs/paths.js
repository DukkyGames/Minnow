/**
 * Safe paths for agent packs under MINNOW_HOME.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Pack folder / manifest id (mirror src/agents/pack-loader.ts). */
export const PACK_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * ~/.minnow/agent-packs/
 */
export function getAgentPacksRoot() {
  return path.join(getMinnowHome(), 'agent-packs');
}

/**
 * ~/.minnow/agent-packs.json — per-pack enable flags.
 */
export function getAgentPacksStatePath() {
  return path.join(getMinnowHome(), 'agent-packs.json');
}

/**
 * Validate pack directory / manifest id.
 * @param {string} packId
 */
export function assertValidPackId(packId) {
  if (!packId || typeof packId !== 'string' || !PACK_ID_RE.test(packId)) {
    throw new Error('Invalid agent pack id');
  }
}

/**
 * Resolve a prompt path relative to pack root; must stay under pack root.
 * @param {string} packRoot
 * @param {string} relativePath
 */
export function resolvePackPromptPath(packRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Invalid prompt path');
  }
  const rel = relativePath.replace(/\\/g, '/').trim();
  if (rel.includes('..') || path.isAbsolute(rel)) {
    throw new Error('Prompt path must be relative to pack root');
  }
  const root = path.resolve(packRoot);
  const full = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error('Prompt path escapes pack directory');
  }
  return full;
}

/**
 * @param {string} packId
 * @returns {string}
 */
export function packDirectoryPath(packId) {
  assertValidPackId(packId);
  return path.join(getAgentPacksRoot(), packId);
}
