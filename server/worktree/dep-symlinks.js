/**
 * Symlink dependency directories from the main workspace into new git worktrees.
 *
 * Links are validated on every provisioning pass and repaired in place: a dangling,
 * looping or drifted link is removed and recreated. Nothing throws, but failures are
 * *reported* rather than swallowed — a link that cannot be made to resolve must reach
 * the caller, because a silently broken `node_modules` junction is what makes every
 * later `npm run` in that worktree die with `spawn ELOOP`.
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

const errMessage = (err) => (err instanceof Error ? err.message : String(err));

/** True when `a` and `b` name the same path (case-insensitive on win32, via path.relative). */
function samePath(a, b) {
  return path.relative(a, b) === '';
}

/** True when `child` lives underneath `parent` (and is not `parent` itself). */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Health of a dependency dir slot in a worktree.
 *
 * The `fs.stat` call is the whole point: `lstat` (and therefore `fs.access` /
 * `pathExists`) reports a dangling or self-referential junction as present, which is
 * how a broken link survived every provisioning pass. `stat` follows the link and
 * throws — ELOOP, ENOENT, EPERM, UNKNOWN — which is the signal we act on.
 *
 * @param {string} linkPath — absolute path of the dep dir inside the worktree
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
    // A real directory is a materialized install; a stray file in its place is broken.
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
 * Remove a link/junction (never a real dir — callers short-circuit on `real-dir`) and
 * confirm it is actually gone. Windows keeps the entry when a handle is open, so the
 * post-check is what stops us from treating a surviving link as removed.
 * @returns {Promise<boolean>} true when the path no longer exists
 */
async function removeDepLink(target) {
  try {
    await fs.rm(target, { force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* the lstat below is the authority, not the rm */
  }
  if (!(await pathExists(target))) return true;

  // Windows junctions answer to rmdir rather than unlink; try both before giving up.
  for (const remove of [() => fs.unlink(target), () => fs.rmdir(target)]) {
    try {
      await remove();
    } catch {
      /* try the next form */
    }
    if (!(await pathExists(target))) return true;
  }
  return false;
}

/**
 * Ensure the known dependency dirs of `sourceRoot` are present and *resolving* in
 * `wtPath`, linking, relinking or repairing as needed. Idempotent, so it is safe to
 * run on every provisioning pass — which is how already-broken worktrees heal.
 *
 * Per dir: a real directory is left alone (a materialized install), a healthy link is
 * left alone unless it drifted off the current source, and a broken link is removed
 * and recreated.
 *
 * @param {string} sourceRoot — dependency source root (main workspace or integration)
 * @param {string} wtPath — worktree path (absolute)
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

      // A source that simply is not installed is not an error — there is nothing to
      // link. A source that exists but does not resolve is: linking from it would
      // silently leave the worktree with no deps at all.
      const sourceState = await inspectDepDir(sourceDir);
      if (sourceState === 'missing') continue;
      if (sourceState === 'broken') {
        failed.push({ dir, reason: `dependency source ${sourceDir} does not resolve` });
        continue;
      }

      // Cheap self-link guard, before touching anything on disk.
      if (samePath(sourceDir, targetLink)) {
        failed.push({ dir, reason: `refusing to link ${dir} to itself (${targetLink})` });
        continue;
      }

      const state = await inspectDepDir(targetLink);
      if (state === 'real-dir') continue;

      let realSource;
      try {
        // Collapse seed junctions (integration → main) so tasks get a single-hop link.
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
        // Already pointing at the intended source — nothing to do.
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

      // A link that does not resolve must never be left behind: the next pass would
      // see it through lstat and report the worktree as already provisioned.
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
 * Link known dependency dirs from `sourceRoot` into `wtPath` when manifests match.
 * Thin wrapper kept for existing callers — see `ensureDependencyDirs`.
 * @param {string} sourceRoot — main workspace root (absolute)
 * @param {string} wtPath — new worktree path (absolute)
 */
export async function symlinkDependencyDirs(sourceRoot, wtPath) {
  return ensureDependencyDirs(sourceRoot, wtPath);
}

/**
 * Replace symlink/junction dep dirs with nothing so the next install creates a real
 * directory in `root` instead of writing through into the link target (e.g. main
 * workspace `node_modules`). Real directories are left untouched.
 *
 * Reports what survived: on Windows an open handle turns the `rm` into a no-op, and
 * installing through a surviving junction writes into the *source* workspace.
 * @param {string} root — worktree root (absolute)
 * @param {string[]} dirs — dependency dir names (e.g. `node_modules`)
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
      continue; /* missing dir — installer will create it */
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
