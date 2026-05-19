/**
 * Spawn `npx impeccable <command>` for UI Designer (Step 15).
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const IMPECCABLE_TIMEOUT_MS = 60_000;
const MAX_STDOUT_CHARS = 32_000;

const ALLOWED_COMMANDS = new Set([
  'audit',
  'critique',
  'shape',
  'craft',
  'polish',
  'teach',
  'document',
  'extract',
  'detect',
  'live',
]);

/**
 * Run an Impeccable CLI sub-command in the project root.
 * @param {object} args
 * @param {string} args.command
 * @param {string} [args.target]
 * @param {string} projectRoot
 */
export function toolRunImpeccable(args, projectRoot) {
  const command = typeof args?.command === 'string' ? args.command.trim() : '';
  if (!command || !ALLOWED_COMMANDS.has(command)) {
    return Promise.resolve({
      result: `Error: run_impeccable command must be one of: ${[...ALLOWED_COMMANDS].join(', ')}`,
    });
  }

  const target = typeof args?.target === 'string' ? args.target.trim() : '';
  const cliArgs = [command];
  if (target) cliArgs.push(target);

  return new Promise((resolve) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['impeccable', ...cliArgs],
      {
        cwd: projectRoot,
        env: { ...process.env, IMPECCABLE_CONTEXT_DIR: projectRoot },
        shell: process.platform === 'win32',
      },
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, IMPECCABLE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDOUT_CHARS) {
        stdout = `${stdout.slice(0, MAX_STDOUT_CHARS)}\n…[truncated]`;
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const relRoot = path.basename(projectRoot) === 'SpeedChat' ? '.' : projectRoot;
      if (timedOut) {
        resolve({
          result: `Error: run_impeccable timed out after ${IMPECCABLE_TIMEOUT_MS / 1000}s`,
        });
        return;
      }
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const prefix = code === 0 ? '' : `Error: impeccable ${command} exited ${code}\n`;
      resolve({
        result: prefix + (combined || `(no output; cwd ${relRoot})`),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        result: `Error: failed to spawn npx impeccable: ${err.message}`,
      });
    });
  });
}
