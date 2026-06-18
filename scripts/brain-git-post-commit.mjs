#!/usr/bin/env node
/**
 * Git post-commit hook — notify a running Minnow dev server to incrementally reindex
 * files touched in HEAD. User-installed via Brain Settings (not auto-installed).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const port = Number(process.env.MINNOW_PORT ?? process.env.PORT ?? 5173);
const baseUrl = process.env.MINNOW_URL ?? `http://127.0.0.1:${port}`;

async function listChangedFiles() {
  const { stdout } = await execFileAsync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

async function notifyCascade(files) {
  const res = await fetch(`${baseUrl}/api/brain/code/cascade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'git-hook', files }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cascade request failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  const files = await listChangedFiles();
  if (!files.length) return;
  await notifyCascade(files);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[minnow-brain-hook] ${message}`);
  process.exitCode = 1;
});
