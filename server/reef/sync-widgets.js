/**
 * Copy built-in reef widget templates into ~/.minnow/reef/widgets for discovery via tools.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getBuiltinReefWidgetsDir, getHomeReefWidgetsDir } from './widget-paths.js';

/**
 * Sync *.md templates from install dir to MINNOW_HOME (overwrite on each start).
 * @param {string} [appRoot] unused; uses getAppRoot() via widget-paths
 */
export async function syncReefWidgetTemplates() {
  const srcDir = getBuiltinReefWidgetsDir();
  const destDir = getHomeReefWidgetsDir();

  try {
    await fs.access(srcDir);
  } catch {
    return { copied: 0, skipped: true };
  }

  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  let copied = 0;

  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    const from = path.join(srcDir, ent.name);
    const to = path.join(destDir, ent.name);
    await fs.copyFile(from, to);
    copied += 1;
  }

  return { copied, destDir };
}
