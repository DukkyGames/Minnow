/**
 * Open a validated absolute path in the OS file manager from the Electron main process.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';

export type ShellRevealKind = 'file' | 'dir';

/**
 * Reveal a file (select in parent folder) or open a directory in Explorer / Finder.
 */
export async function revealAbsolutePathInExplorer(
  absolutePath: string,
  kind: ShellRevealKind,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = path.normalize(String(absolutePath ?? '').trim());
  if (!normalized) {
    return { ok: false, error: 'path is required' };
  }

  try {
    await fs.stat(normalized);
  } catch {
    return { ok: false, error: `Path does not exist: ${normalized}` };
  }

  if (kind === 'dir') {
    const openError = await shell.openPath(normalized);
    if (openError) {
      return { ok: false, error: openError };
    }
    return { ok: true };
  }

  shell.showItemInFolder(normalized);
  return { ok: true };
}
