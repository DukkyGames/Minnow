/**
 * Symlink dependency directories from the main workspace into new git worktrees.
 * Best-effort only — failures are logged and never thrown.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Manifest files → dependency dirs to link when the manifest exists in sourceRoot. */
const ECOSYSTEM_ENTRIES = [
  { manifests: ['package.json'], dirs: ['node_modules'] },
  { manifests: ['go.mod'], dirs: ['vendor'] },
  { manifests: ['Cargo.toml'], dirs: ['target'] },
  { manifests: ['pyproject.toml', 'setup.py', 'requirements.txt'], dirs: ['.venv', 'venv'] },
  { manifests: ['Gemfile'], dirs: ['vendor', '.bundle'] },
  { manifests: ['composer.json'], dirs: ['vendor'] },
];

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(dirPath) {
  try {
    const st = await fs.stat(dirPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Link known dependency dirs from `sourceRoot` into `wtPath` when manifests match.
 * Skips dirs that already exist in the worktree; deduplicates names like `vendor`.
 * @param {string} sourceRoot — main workspace root (absolute)
 * @param {string} wtPath — new worktree path (absolute)
 */
export async function symlinkDependencyDirs(sourceRoot, wtPath) {
  const linked = new Set();
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

  for (const entry of ECOSYSTEM_ENTRIES) {
    const hasManifest = await Promise.all(
      entry.manifests.map((manifest) => pathExists(path.join(sourceRoot, manifest))),
    );
    if (!hasManifest.some(Boolean)) continue;

    for (const dir of entry.dirs) {
      if (linked.has(dir)) continue;
      linked.add(dir);

      const sourceDir = path.join(sourceRoot, dir);
      const targetLink = path.join(wtPath, dir);

      if (!(await isDirectory(sourceDir))) continue;
      if (await pathExists(targetLink)) continue;

      try {
        await fs.symlink(sourceDir, targetLink, symlinkType);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[dep-symlinks] failed to link ${dir} into ${wtPath}: ${message}`);
      }
    }
  }
}
