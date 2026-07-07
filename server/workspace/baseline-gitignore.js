/**
 * Baseline .gitignore for fresh workspaces (git-setup skill / board preflight).
 * Never overwrites an existing file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { isResolvedPathUnderRoot } from './safe-path.js';
import { getWorkspaceRoot } from './root.js';

/** Default ignore patterns applied when .gitignore is missing. */
export const BASELINE_GITIGNORE_LINES = [
  '# Baseline ignores (created by Minnow git-setup)',
  '',
  '# Dependencies',
  'node_modules/',
  '',
  '# Build output',
  'dist/',
  'build/',
  '',
  '# Environment / secrets',
  '.env',
  '.env.*',
  '',
  '# OS junk',
  '.DS_Store',
  'Thumbs.db',
  '',
];

/** Serialized baseline .gitignore body (trailing newline). */
export const BASELINE_GITIGNORE_CONTENT = `${BASELINE_GITIGNORE_LINES.join('\n')}\n`;

/**
 * Create `.gitignore` with baseline patterns when absent.
 * @param {string} [workspaceRoot]
 * @returns {Promise<{ ok: true; created: boolean; path: string } | { ok: false; error: string }>}
 */
export async function ensureBaselineGitignore(workspaceRoot) {
  const root = workspaceRoot?.trim() || getWorkspaceRoot();
  const gitignorePath = path.resolve(root, '.gitignore');

  if (!isResolvedPathUnderRoot(gitignorePath, root)) {
    return { ok: false, error: 'Refusing to write .gitignore outside workspace root' };
  }

  try {
    await fs.access(gitignorePath);
    return { ok: true, created: false, path: gitignorePath };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
    if (code !== 'ENOENT') {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  try {
    await fs.writeFile(gitignorePath, BASELINE_GITIGNORE_CONTENT, 'utf8');
    return { ok: true, created: true, path: gitignorePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
