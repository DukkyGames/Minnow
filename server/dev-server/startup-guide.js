/**
 * Read and parse workspace-root startup.md (shared by manager + registry).
 */

import fs from 'node:fs/promises';
import { parseStartupMarkdown, startupFilePath } from './parse-startup.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

/**
 * @param {string} [workspaceRoot]
 */
export async function readStartupGuide(workspaceRoot = getEffectiveWorkspaceRoot()) {
  const filePath = startupFilePath(workspaceRoot);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = parseStartupMarkdown(content);
    return {
      exists: true,
      path: filePath,
      guide: parsed.guide,
      parseError: parsed.error,
      body: parsed.body,
    };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
    if (code === 'ENOENT') {
      return { exists: false, path: filePath, guide: null, parseError: undefined, body: '' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { exists: false, path: filePath, guide: null, parseError: message, body: '' };
  }
}
