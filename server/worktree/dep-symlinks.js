import fs from 'node:fs/promises';
import path from 'node:path';

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

const errMessage = (err) => (err instanceof Error ? err.message : String(err));

function samePath(a, b) {
  return path.relative(a, b) === '';
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @param {string} linkPath
 * @returns {Promise<'missing' | 'real-dir' | 'link-ok' | 'broken'>}
 */
export async function inspectDepDir(linkPath) {
  let st;
  try {
    st = await fs.lstat(linkPath);
  } catch {
    return 'missing';
  }
  if (!st.isSymbolicLink()) {
    return st.isDirectory() ? 'real-dir' : 'broken';
  }
  try {
    const target = await fs.stat(linkPath);
    return target.isDirectory() ? 'link-ok' : 'broken';
  } catch {
    return 'broken';
  }
}

/**
 * @returns {Promise<boolean>}
 */
async function removeDepLink(target) {
  try {
    await fs.rm(target, { force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
  }
  if (!(await pathExists(target))) return true;

  for (const remove of [() => fs.unlink(target), () => fs.rmdir(target)]) {
    try {
      await remove();
    } catch {
    }
    if (!(await pathExists(target))) return true;
  }
  return false;
}

/**
 * @param {string} sourceRoot
 * @param {string} wtPath
 * @returns {Promise<{ ok: boolean, linked: string[], repaired: string[], failed: Array<{ dir: string, reason: string }> }>}
 */
export async function ensureDependencyDirs(sourceRoot, wtPath) {
  const linked = [];
  const repaired = [];
  const failed = [];
  const seen = new Set();
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

  for (const entry of ECOSYSTEM_ENTRIES) {
    const hasManifest = await Promise.all(
      entry.manifests.map((manifest) => pathExists(path.join(sourceRoot, manifest))),
    );
    if (!hasManifest.some(Boolean)) continue;

    for (const dir of entry.dirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);

      const sourceDir = path.join(sourceRoot, dir);
      const targetLink = path.join(wtPath, dir);

      const sourceState = await inspectDepDir(sourceDir);
      if (sourceState === 'missing' || sourceState === 'broken') {
        const targetState = await inspectDepDir(targetLink);
        if (targetState === 'broken' && !(await removeDepLink(targetLink))) {
          failed.push({
            dir,
            reason: `existing ${dir} link could not be removed (${targetLink})`,
          });
        } else if (sourceState === 'broken') {
          failed.push({ dir, reason: `dependency source ${sourceDir} does not resolve` });
        }
        continue;
      }

      if (samePath(sourceDir, targetLink)) {
        failed.push({ dir, reason: `refusing to link ${dir} to itself (${targetLink})` });
        continue;
      }

      const state = await inspectDepDir(targetLink);
      if (state === 'real-dir') continue;

      let realSource;
      try {
        realSource = await fs.realpath(sourceDir);
      } catch (err) {
        failed.push({ dir, reason: `source ${sourceDir} does not resolve: ${errMessage(err)}` });
        continue;
      }

      const resolvedTarget = path.resolve(targetLink);
      if (samePath(resolvedTarget, realSource)) {
        failed.push({ dir, reason: `refusing to link ${dir} to itself (${realSource})` });
        continue;
      }
      if (isInside(resolvedTarget, realSource) || isInside(realSource, resolvedTarget)) {
        failed.push({
          dir,
          reason: `refusing to create a self-nested ${dir} link (${resolvedTarget} / ${realSource})`,
        });
        continue;
      }

      if (state === 'link-ok') {
        let current = null;
        try {
          current = await fs.realpath(targetLink);
        } catch {
          current = null;
        }
        if (current && samePath(current, realSource)) continue;
      }

      if (state !== 'missing' && !(await removeDepLink(targetLink))) {
        failed.push({
          dir,
          reason: `existing ${dir} link could not be removed (${targetLink})`,
        });
        continue;
      }

      try {
        await fs.symlink(realSource, targetLink, symlinkType);
      } catch (err) {
        failed.push({ dir, reason: `failed to link ${dir}: ${errMessage(err)}` });
        continue;
      }

      if ((await inspectDepDir(targetLink)) !== 'link-ok') {
        await removeDepLink(targetLink);
        failed.push({ dir, reason: `created ${dir} link does not resolve (${realSource})` });
        continue;
      }

      if (state === 'missing') linked.push(dir);
      else repaired.push(dir);
    }
  }

  for (const { reason } of failed) {
    console.warn(`[dep-symlinks] ${wtPath}: ${reason}`);
  }

  return { ok: failed.length === 0, linked, repaired, failed };
}

/**
 * @param {string} root
 * @returns {Promise<boolean>}
 */
export async function hasBrokenDepDir(root) {
  const seen = new Set();
  for (const entry of ECOSYSTEM_ENTRIES) {
    for (const dir of entry.dirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      if ((await inspectDepDir(path.join(root, dir))) === 'broken') return true;
    }
  }
  return false;
}

/**
 * @param {string} sourceRoot
 * @param {string} wtPath
 */
export async function symlinkDependencyDirs(sourceRoot, wtPath) {
  return ensureDependencyDirs(sourceRoot, wtPath);
}

/**
 * @param {string} root
 * @param {string[]} dirs
 * @returns {Promise<{ removed: string[], failed: string[] }>}
 */
export async function materializeDepDirs(root, dirs) {
  const removed = [];
  const failed = [];

  for (const dir of dirs) {
    const depPath = path.join(root, dir);
    let st;
    try {
      st = await fs.lstat(depPath);
    } catch {
      continue; 
    }
    if (!st.isSymbolicLink()) continue;

    if (await removeDepLink(depPath)) {
      removed.push(dir);
    } else {
      failed.push(dir);
      console.warn(`[dep-symlinks] ${root}: could not remove ${dir} link before install`);
    }
  }

  return { removed, failed };
}
