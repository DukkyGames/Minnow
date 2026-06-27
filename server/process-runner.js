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
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.killTree]
 *   Platform-aware tree killer injected by callers (avoids circular imports).
 *   Falls back to child.kill('SIGTERM') when omitted.
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
    killTree,
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
    let settled = false;

    let graceTimer = null;

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      fn();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // Use injected tree-killer so Windows grandchild processes are also killed.
      // On Windows, child.kill('SIGTERM') only kills cmd.exe, leaving node grandchildren
      // alive and holding stdout/stderr pipes open, so 'close' never fires.
      if (killTree) {
        killTree(child);
      } else {
        child.kill('SIGTERM');
      }
      // Grace period: if 'close' still hasn't fired after the kill, settle anyway so
      // the promise never hangs indefinitely.
      graceTimer = setTimeout(() => {
        settle(() => reject(new Error(`Command timed out after ${timeout / 1000}s`)));
      }, 3000);
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

    // A SIGTERM/force-kill can break these pipes and emit a stream 'error'; without
    // a listener Node rethrows it as an uncaughtException and crashes the host.
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});

    child.on('error', (err) => {
      settle(() => reject(err));
    });

    child.on('close', (code) => {
      if (timedOut) {
        settle(() => reject(new Error(`Command timed out after ${timeout / 1000}s`)));
        return;
      }
      settle(() => resolve({ code: code ?? 1, stdout, stderr, timedOut: false }));
    });
  });
}

/**
 * Format process output for tool results (blocking /api/tools path).
 * @param {string} label
 * @param {{ code: number, stdout: string, stderr: string, timedOut?: boolean, stopped?: boolean, timeoutSecs?: number }} result
 */
export function formatProcessOutput(label, { code, stdout, stderr, timedOut = false, stopped = false, timeoutSecs }) {
  const parts = [
    stopped
      ? `${label} (stopped by user — process terminated, not a failure)`
      : timedOut
        ? `${label} (timed out after ${timeoutSecs ?? COMMAND_TIMEOUT_MS / 1000}s)`
        : `${label} (exit ${code})`,
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
