#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  isDevHostProcessAlive,
  readDevHostState,
} from '../server/runtime/dev-host-state.js';
import { readSessionTokenFile } from '../server/runtime/session-token.js';
import { resolveMinnowPort } from '../server/constants/minnow-port.js';

const execFileAsync = promisify(execFile);

function resolveSessionToken() {
  const fromEnv = process.env.MINNOW_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return readSessionTokenFile();
}

function resolveBaseUrl() {
  const explicit = process.env.MINNOW_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const state = readDevHostState();
  if (state?.localUrl && isDevHostProcessAlive(state)) {
    return state.localUrl.replace(/\/$/, '');
  }

  const port = resolveMinnowPort();
  return `http://127.0.0.1:${port}`;
}

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
  const baseUrl = resolveBaseUrl();
  const token = resolveSessionToken();
/** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Minnow-Token'] = token;

  let res;
  try {
    res = await fetch(`${baseUrl}/api/brain/code/cascade`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ trigger: 'git-hook', files }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hookErr = new Error(message);
    hookErr.bestEffort = true;
    throw hookErr;
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Cascade request failed (${res.status}): unauthorized`);
    err.bestEffort = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cascade request failed (${res.status}): ${text}`);
  }
  return res.json();
}

function logHookDebug(message) {
  if (process.env.MINNOW_DEBUG === '1') {
    console.error(`[minnow-brain-hook] ${message}`);
  }
}

async function main() {
  const files = await listChangedFiles();
  if (!files.length) return;
  await notifyCascade(files);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const bestEffort = Boolean(err?.bestEffort);
  if (bestEffort) {
    logHookDebug(message);
    if (process.env.MINNOW_DEBUG === '1') {
      process.exitCode = 1;
    }
    return;
  }
  console.error(`[minnow-brain-hook] ${message}`);
  process.exitCode = 1;
});
