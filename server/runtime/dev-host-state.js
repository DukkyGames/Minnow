/**
 * Persist the bound Minnow dev-server URL so Electron can load the same port
 * when Vite auto-increments (strictPort: false) or PORT drifts from the shell.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const FILE_NAME = 'dev-host.json';

function statePath() {
  return path.join(getMinnowHome(), 'run', FILE_NAME);
}

/**
 * @param {{ localUrl: string, port: number }} info
 */
export function writeDevHostState(info) {
  const dir = path.dirname(statePath());
  fs.mkdirSync(dir, { recursive: true });
  const localUrl = info.localUrl.trim().replace(/\/$/, '');
  const port = Number(info.port);
  const payload = {
    pid: process.pid,
    port: Number.isFinite(port) ? port : Number(new URL(`${localUrl}/`).port) || 0,
    localUrl,
    ts: Date.now(),
  };
  fs.writeFileSync(statePath(), `${JSON.stringify(payload)}\n`, 'utf8');
}

/** Whether the process that wrote dev-host.json is still running. */
export function isDevHostProcessAlive(state) {
  const pid = Number(state?.pid);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ pid: number, port: number, localUrl: string, ts: number } | null} */
export function readDevHostState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.localUrl !== 'string') return null;
    const port = Number(parsed.port);
    if (!Number.isFinite(port) || port <= 0) return null;
    return {
      pid: Number(parsed.pid) || 0,
      port,
      localUrl: parsed.localUrl.replace(/\/$/, ''),
      ts: Number(parsed.ts) || 0,
    };
  } catch {
    return null;
  }
}

export function clearDevHostState() {
  try {
    fs.unlinkSync(statePath());
  } catch {
    /* already gone */
  }
}
