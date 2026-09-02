#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} root
 * @returns {string[]}
 */
export function minnowProcessMatchSubstrings(root) {
  const normalizedRoot = root.replace(/\\/g, '/');
  return [
    'Minnow.app/Contents/MacOS/Minnow',
    `${normalizedRoot}/electron/dist/main.js`,
    `${normalizedRoot}/release/pkg/mac`,
    `${normalizedRoot}/release/pkg/win-unpacked`,
    `${normalizedRoot}/release/win-unpacked`,
  ];
}

/**
 * @param {string} commandLine
 * @param {string} [root]
 */
export function commandLineLooksLikeMinnow(commandLine, root = repoRoot) {
  const line = commandLine.replace(/\\/g, '/');
  return minnowProcessMatchSubstrings(root).some((fragment) => line.includes(fragment));
}

function tryExec(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
  }
}

/** @returns {{ pid: number; command: string }[]} */
function listUnixProcesses() {
  const result = spawnSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' });
  if (result.status !== 0) return [];

/** @type {{ pid: number; command: string }[]} */
  const rows = [];
  for (const raw of result.stdout.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), command: match[2] });
  }
  return rows;
}

function killUnixMinnowProcesses() {
  const self = process.pid;
  for (const { pid, command } of listUnixProcesses()) {
    if (pid === self) continue;
    if (!commandLineLooksLikeMinnow(command)) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
    }
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Packaged installer binary only — do not taskkill every electron.exe.
export function stopMinnowProcessesForPackaging() {
  const isWin = process.platform === 'win32';
  if (isWin) {
    tryExec('taskkill /F /IM Minnow.exe /T');
  } else {
    killUnixMinnowProcesses();
  }
}

if (isMain) {
  stopMinnowProcessesForPackaging();
}
