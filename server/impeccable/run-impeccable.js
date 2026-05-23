/**
 * Run Impeccable CLI (detect) or bundled scripts (live) in the active workspace.
 * Harness commands (teach, audit, shape, …) return guidance — they are not npm CLI sub-commands.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  harnessCommandGuidance,
  isCliCommand,
  isHarnessCommand,
  isScriptCommand,
  listAcceptedRunImpeccableCommands,
  SCRIPT_COMMANDS,
} from './command-routing.js';

const IMPECCABLE_TIMEOUT_MS = 60_000;
const MAX_STDOUT_CHARS = 32_000;

/**
 * @param {object} args
 * @param {string} args.command
 * @param {string} [args.target]
 * @param {string} appRoot Minnow install root (bundled scripts)
 * @param {string} projectRoot Active workspace
 */
export function toolRunImpeccable(args, appRoot, projectRoot) {
  const command = typeof args?.command === 'string' ? args.command.trim() : '';
  const accepted = listAcceptedRunImpeccableCommands();

  if (!command || !accepted.includes(command)) {
    return Promise.resolve({
      result: `Error: run_impeccable command must be one of: ${accepted.join(', ')}`,
    });
  }

  if (isHarnessCommand(command) && !isScriptCommand(command)) {
    return Promise.resolve({ result: harnessCommandGuidance(command) });
  }

  const target = typeof args?.target === 'string' ? args.target.trim() : '';

  if (isCliCommand(command)) {
    return runNpxImpeccable(command, target, projectRoot);
  }

  if (isScriptCommand(command)) {
    return runBundledScript(command, target, appRoot, projectRoot);
  }

  return Promise.resolve({
    result: `Error: unsupported run_impeccable command: ${command}`,
  });
}

/**
 * @param {string} command
 * @param {string} target
 * @param {string} projectRoot
 */
function runNpxImpeccable(command, target, projectRoot) {
  const cliArgs = [command];
  if (target) cliArgs.push(target);

  return spawnWithCapture(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['impeccable', ...cliArgs],
    {
      cwd: projectRoot,
      env: { ...process.env, IMPECCABLE_CONTEXT_DIR: projectRoot },
      shell: process.platform === 'win32',
    },
    command,
    projectRoot,
    `npx impeccable`,
  );
}

/**
 * @param {string} command
 * @param {string} target
 * @param {string} appRoot
 * @param {string} projectRoot
 */
function runBundledScript(command, target, appRoot, projectRoot) {
  const relScript = SCRIPT_COMMANDS.get(command);
  if (!relScript) {
    return Promise.resolve({
      result: `Error: no bundled script for command: ${command}`,
    });
  }

  const scriptPath = path.join(appRoot, 'src', 'skills', 'impeccable', relScript);
  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({
      result: `Error: missing Impeccable script at ${scriptPath}. Re-run npm install in the Minnow app directory.`,
    });
  }

  const nodeArgs = [scriptPath];
  if (target) nodeArgs.push(target);

  return spawnWithCapture(
    process.execPath,
    nodeArgs,
    {
      cwd: projectRoot,
      env: { ...process.env, IMPECCABLE_CONTEXT_DIR: projectRoot },
    },
    command,
    projectRoot,
    path.basename(scriptPath),
  );
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 * @param {string} commandLabel
 * @param {string} projectRoot
 * @param {string} spawnLabel
 */
function spawnWithCapture(cmd, args, options, commandLabel, projectRoot, spawnLabel) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, options);

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
      const relRoot = path.basename(projectRoot) === 'Minnow' ? '.' : projectRoot;
      if (timedOut) {
        resolve({
          result: `Error: run_impeccable timed out after ${IMPECCABLE_TIMEOUT_MS / 1000}s`,
        });
        return;
      }
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const prefix =
        code === 0 ? '' : `Error: impeccable ${commandLabel} exited ${code}\n`;
      resolve({
        result: prefix + (combined || `(no output; cwd ${relRoot})`),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        result: `Error: failed to spawn ${spawnLabel}: ${err.message}`,
      });
    });
  });
}
