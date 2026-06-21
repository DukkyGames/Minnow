/**
 * Refresh shared dependency dirs after manifest/lockfile changes land in integration.
 * Best-effort only — failures are logged and never thrown.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../process-runner.js';
import { ECOSYSTEM_ENTRIES } from './dep-symlinks.js';

const INSTALL_TIMEOUT_MS = 600_000;

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run ecosystem install commands when `changedFiles` touched a manifest or lockfile.
 * @param {string} root — integration worktree root (absolute)
 * @param {string[]} changedFiles — paths from a post-merge git diff
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ ran: string[], failed: string[] }>}
 */
export async function refreshDependencies(root, changedFiles, { timeout = INSTALL_TIMEOUT_MS } = {}) {
  const ran = [];
  const failed = [];

  try {
    const changedBasenames = new Set(changedFiles.map((f) => path.basename(f)));
    const seenCommands = new Set();

    for (const entry of ECOSYSTEM_ENTRIES) {
      const triggers = [...entry.manifests, ...(entry.lockfiles ?? [])];
      if (!triggers.some((name) => changedBasenames.has(name))) continue;

      const hasManifest = await Promise.all(
        entry.manifests.map((manifest) => pathExists(path.join(root, manifest))),
      );
      if (!hasManifest.some(Boolean)) continue;

      const install = await entry.resolveInstall(root);
      if (!install) continue;

      const dedupeKey = `${install.command}\0${install.args.join('\0')}`;
      if (seenCommands.has(dedupeKey)) continue;
      seenCommands.add(dedupeKey);

      const label = `${install.command} ${install.args.join(' ')}`;
      try {
        const result = await runProcess(install.command, install.args, {
          cwd: root,
          timeout,
          shell: process.platform === 'win32',
        });
        if (result.code === 0) {
          ran.push(label);
        } else {
          failed.push(label);
          const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
          console.warn(
            `[dep-install] ${label} exited ${result.code}${detail ? `: ${detail}` : ''}`,
          );
        }
      } catch (err) {
        failed.push(label);
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[dep-install] ${label} failed: ${message}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[dep-install] unexpected error: ${message}`);
  }

  return { ran, failed };
}
