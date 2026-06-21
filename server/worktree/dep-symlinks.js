/**
 * Symlink dependency directories from the main workspace into new git worktrees.
 * Best-effort only — failures are logged and never thrown.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Manifest files → dependency dirs to link when the manifest exists in sourceRoot. */
export const ECOSYSTEM_ENTRIES = [
  {
    manifests: ['package.json'],
    lockfiles: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
    dirs: ['node_modules'],
    async resolveInstall(root) {
      if (!(await pathExists(path.join(root, 'package.json')))) return null;
      if (await pathExists(path.join(root, 'pnpm-lock.yaml'))) {
        return { command: 'pnpm', args: ['install'] };
      }
      if (await pathExists(path.join(root, 'yarn.lock'))) {
        return { command: 'yarn', args: ['install'] };
      }
      if (await pathExists(path.join(root, 'bun.lockb'))) {
        return { command: 'bun', args: ['install'] };
      }
      return { command: 'npm', args: ['install'] };
    },
  },
  {
    manifests: ['go.mod'],
    lockfiles: ['go.sum'],
    dirs: ['vendor'],
    async resolveInstall(root) {
      if (!(await pathExists(path.join(root, 'go.mod')))) return null;
      return { command: 'go', args: ['mod', 'download'] };
    },
  },
  {
    manifests: ['Cargo.toml'],
    lockfiles: ['Cargo.lock'],
    dirs: ['target'],
    async resolveInstall(root) {
      if (!(await pathExists(path.join(root, 'Cargo.toml')))) return null;
      return { command: 'cargo', args: ['fetch'] };
    },
  },
  {
    manifests: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    lockfiles: ['poetry.lock', 'uv.lock', 'Pipfile.lock', 'requirements.txt'],
    dirs: ['.venv', 'venv'],
    async resolveInstall(root) {
      if (!(await pathExists(path.join(root, 'requirements.txt')))) return null;
      return { command: 'python', args: ['-m', 'pip', 'install', '-r', 'requirements.txt'] };
    },
  },
  {
    manifests: ['Gemfile'],
    lockfiles: ['Gemfile.lock'],
    dirs: ['vendor', '.bundle'],
    async resolveInstall(root) {
      if (!(await pathExists(path.join(root, 'Gemfile')))) return null;
      return { command: 'bundle', args: ['install'] };
    },
  },
  {
    manifests: ['composer.json'],
    lockfiles: ['composer.lock'],
    dirs: ['vendor'],
    async resolveInstall(root) {
      if (!(await pathExists(path.join(root, 'composer.json')))) return null;
      return { command: 'composer', args: ['install'] };
    },
  },
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
