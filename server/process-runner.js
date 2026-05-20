/**
 * Subprocess runner shared by git tools and the terminal streaming layer.
 */

import { spawn } from 'node:child_process';

/** Default timeout for shell/code tools (ms). */
export const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Run a subprocess; collect stdout/stderr; optional per-chunk callbacks for streaming.
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {number} [options.timeout]
 * @param {Record<string, string>} [options.env]
 * @param {boolean} [options.shell]
 * @param {(text: string) => void} [options.onStdout]
 * @param {(text: string) => void} [options.onStderr]
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.onSpawn]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeout = COMMAND_TIMEOUT_MS,
    env,
    shell = false,
    onStdout,
    onStderr,
    onSpawn,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      windowsHide: true,
    });

    onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout / 1000}s`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr, timedOut: false });
    });
  });
}

/**
 * Format process output for tool results (blocking /api/tools path).
 * @param {string} label
 * @param {{ code: number, stdout: string, stderr: string, timedOut?: boolean }} result
 */
export function formatProcessOutput(label, { code, stdout, stderr, timedOut = false }) {
  const parts = [
    timedOut ? `${label} (timed out after ${COMMAND_TIMEOUT_MS / 1000}s)` : `${label} (exit ${code})`,
  ];
  if (stdout.trim()) {
    parts.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.trim()) {
    parts.push(`stderr:\n${stderr.trimEnd()}`);
  }
  if (!stdout.trim() && !stderr.trim()) {
    parts.push('(no output)');
  }
  return parts.join('\n\n');
}
