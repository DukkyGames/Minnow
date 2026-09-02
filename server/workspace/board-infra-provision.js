import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runProcess } from '../process-runner.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';
import { inspectDepDir } from '../worktree/dep-symlinks.js';

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
 * @param {string} workspaceRoot
 * @param {object} opts
 * @param {number} [opts.timeoutMs]
 * @param {string[]} [opts.services]
 * @returns {Promise<{ ok: boolean, steps: string[], failed: string[], signatures: string[] }>}
 */
export async function provisionBoardInfra(workspaceRoot, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const requestedServices = Array.isArray(opts.services) ? opts.services : [];
  const steps = [];
  const failed = [];
  const signatures = [];

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

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const nodeModulesPath = path.join(workspaceRoot, 'node_modules');
  const nodeModulesState = await fileExists(packageJsonPath)
    ? await inspectDepDir(nodeModulesPath)
    : 'real-dir';
  if (nodeModulesState === 'broken') {
    failed.push(
      `node_modules in ${workspaceRoot} is a broken link — re-provision the worktree dep links`,
    );
  } else if (nodeModulesState === 'missing') {
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

  const hasPyproject = await fileExists(path.join(workspaceRoot, 'pyproject.toml'));
  const hasRequirements = await fileExists(path.join(workspaceRoot, 'requirements.txt'));
  if (hasPyproject || hasRequirements) {
    const venvPath = path.join(workspaceRoot, '.venv');
    const hasVenv = await fileExists(venvPath);
    if (!hasVenv) {
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

    if (await fileExists(venvPath)) {
      const isWindows = process.platform === 'win32';
      const pipBin = isWindows
        ? path.join(venvPath, 'Scripts', 'pip')
        : path.join(venvPath, 'bin', 'pip');

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

export async function toolBoardProvisionInfra(args) {
  const workspaceRoot = getEffectiveWorkspaceRoot();
  const services = Array.isArray(args?.services) ? args.services : [];
  const timeoutMs = typeof args?.timeoutMs === 'number' ? args.timeoutMs : undefined;
  const result = await provisionBoardInfra(workspaceRoot, { services, timeoutMs });
  return JSON.stringify(result, null, 2);
}
