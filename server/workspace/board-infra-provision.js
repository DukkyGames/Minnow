/**
 * Board infra auto-provisioning (MIN-285 Phase 2).
 *
 * GAP-4 scope split: shared services (docker compose, fixed host ports) are
 * board-global and provisioned once, keyed by content signature stored in
 * board.provisionedSignatures. Per-task deps (node_modules, per-worktree venv)
 * are provisioned per worktree root.
 *
 * The handler runs against the worktree workspaceRoot (passed as the top-level
 * workspaceRoot field in the POST body, validated + set as the tool-context
 * override) so getEffectiveWorkspaceRoot() returns the correct worktree path.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runProcess } from '../process-runner.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readFileSafe(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
}

/**
 * Compute a short content-based signature for the given files in root.
 * Returns null when none of the files exist.
 */
async function contentSignature(root, filenames) {
  const parts = [];
  for (const name of filenames) {
    const content = await readFileSafe(path.join(root, name));
    if (content !== null) parts.push(`${name}:${sha1(content)}`);
  }
  if (parts.length === 0) return null;
  return sha1(parts.join('|'));
}

/**
 * Detect and run infra provisioning steps for a worktree.
 *
 * @param {string} workspaceRoot  absolute worktree path
 * @param {object} opts
 * @param {number}  [opts.timeoutMs]  per-command timeout (default 180 000)
 * @param {string[]} [opts.services]  docker compose service names to bring up (all if empty)
 * @returns {Promise<{ ok: boolean, steps: string[], failed: string[], signatures: string[] }>}
 */
export async function provisionBoardInfra(workspaceRoot, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const requestedServices = Array.isArray(opts.services) ? opts.services : [];
  const steps = [];
  const failed = [];
  const signatures = [];

  // ── 1. Docker Compose (shared services, board-global key) ─────────────────
  const composeFile =
    (await fileExists(path.join(workspaceRoot, 'docker-compose.yml')))
      ? 'docker-compose.yml'
      : (await fileExists(path.join(workspaceRoot, 'compose.yaml')))
        ? 'compose.yaml'
        : null;

  if (composeFile) {
    const sig = await contentSignature(workspaceRoot, [composeFile]);
    if (sig) signatures.push(`docker-compose:${sig}`);
    const serviceArgs = requestedServices.length > 0 ? requestedServices : [];
    const composeArgs = ['compose', 'up', '-d', ...serviceArgs];
    try {
      const res = await runProcess('docker', composeArgs, {
        cwd: workspaceRoot,
        timeout: timeoutMs,
      });
      if (res.timedOut) {
        failed.push(`docker compose up timed out after ${timeoutMs}ms`);
      } else if (res.code !== 0) {
        failed.push(`docker compose up failed (exit ${res.code}): ${res.stderr.trim().slice(0, 200)}`);
      } else {
        steps.push('docker compose up -d');
      }
    } catch (err) {
      failed.push(`docker compose up error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 2. Node.js deps (per-worktree) ────────────────────────────────────────
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const nodeModulesPath = path.join(workspaceRoot, 'node_modules');
  if (await fileExists(packageJsonPath) && !(await fileExists(nodeModulesPath))) {
    const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
    let command = 'npm';
    let args = ['ci'];
    for (const lf of lockfiles) {
      if (await fileExists(path.join(workspaceRoot, lf))) {
        if (lf === 'pnpm-lock.yaml') { command = 'pnpm'; args = ['install']; }
        else if (lf === 'yarn.lock') { command = 'yarn'; args = ['install']; }
        else if (lf === 'bun.lockb') { command = 'bun'; args = ['install']; }
        break;
      }
    }
    try {
      const res = await runProcess(command, args, { cwd: workspaceRoot, timeout: timeoutMs });
      if (res.timedOut) {
        failed.push(`${command} ${args.join(' ')} timed out`);
      } else if (res.code !== 0) {
        failed.push(`${command} ${args.join(' ')} failed (exit ${res.code}): ${res.stderr.trim().slice(0, 200)}`);
      } else {
        steps.push(`${command} ${args.join(' ')}`);
      }
    } catch (err) {
      failed.push(`node deps error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 3. Python deps (per-worktree venv — never global pip) ─────────────────
  const hasPyproject = await fileExists(path.join(workspaceRoot, 'pyproject.toml'));
  const hasRequirements = await fileExists(path.join(workspaceRoot, 'requirements.txt'));
  if (hasPyproject || hasRequirements) {
    const venvPath = path.join(workspaceRoot, '.venv');
    const hasVenv = await fileExists(venvPath);
    if (!hasVenv) {
      // Create venv first
      try {
        const res = await runProcess('python3', ['-m', 'venv', '.venv'], {
          cwd: workspaceRoot,
          timeout: timeoutMs,
        });
        if (res.timedOut || res.code !== 0) {
          failed.push(`python3 -m venv .venv failed: ${res.stderr.trim().slice(0, 200)}`);
        } else {
          steps.push('python3 -m venv .venv');
        }
      } catch (err) {
        failed.push(`venv creation error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Only install if venv now exists (or already existed)
    if (await fileExists(venvPath)) {
      const isWindows = process.platform === 'win32';
      const pipBin = isWindows
        ? path.join(venvPath, 'Scripts', 'pip')
        : path.join(venvPath, 'bin', 'pip');

      // Prefer uv if available
      const hasUv = await fileExists(path.join(venvPath, isWindows ? 'Scripts/uv' : 'bin/uv'))
        .then(() => true).catch(() => false);

      let installCommand, installArgs;
      if (hasPyproject && !hasUv) {
        installCommand = pipBin;
        installArgs = ['install', '-e', '.'];
      } else if (hasPyproject) {
        installCommand = 'uv';
        installArgs = ['sync'];
      } else {
        installCommand = pipBin;
        installArgs = ['install', '-r', 'requirements.txt'];
      }

      try {
        const res = await runProcess(installCommand, installArgs, {
          cwd: workspaceRoot,
          timeout: timeoutMs,
        });
        if (res.timedOut) {
          failed.push(`${installCommand} ${installArgs.join(' ')} timed out`);
        } else if (res.code !== 0) {
          failed.push(`python deps install failed (exit ${res.code}): ${res.stderr.trim().slice(0, 200)}`);
        } else {
          steps.push(`${installCommand} ${installArgs.join(' ')}`);
        }
      } catch (err) {
        failed.push(`python deps error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { ok: failed.length === 0, steps, failed, signatures };
}

/**
 * Server tool handler for board_provision_infra.
 * The workspaceRoot is resolved via getEffectiveWorkspaceRoot() so the caller
 * should pass it as the top-level workspaceRoot field in the POST body.
 */
export async function toolBoardProvisionInfra(args) {
  const workspaceRoot = getEffectiveWorkspaceRoot();
  const services = Array.isArray(args?.services) ? args.services : [];
  const timeoutMs = typeof args?.timeoutMs === 'number' ? args.timeoutMs : undefined;
  const result = await provisionBoardInfra(workspaceRoot, { services, timeoutMs });
  return JSON.stringify(result, null, 2);
}
