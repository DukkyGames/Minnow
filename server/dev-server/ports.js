/**
 * Listening-port monitor for the Dev Servers screen (netstat / lsof + guarded kill).
 */

import net from 'node:net';
import { runProcess } from '../process-runner.js';
import { assessPortOwnerKill, isProtectedPortOwner } from '../tools/host-kill-guard.js';

/**
 * @typedef {object} ListeningPortRow
 * @property {number} port
 * @property {string} address
 * @property {number} pid
 * @property {string} process
 * @property {boolean} protected
 */

const LIST_CACHE_MS = 2_000;
const PROBE_TIMEOUT_MS = 400;
const LIST_TIMEOUT_MS = 5_000;

/** @type {{ at: number, rows: ListeningPortRow[] } | null} */
let listCache = null;

/**
 * Lowest free port at or above base, skipping used set (server-side allocateDevPort).
 * @param {number} base
 * @param {Iterable<number>} [used]
 */
export function findFreePort(base, used = []) {
  const taken = new Set(
    [...used].filter((n) => typeof n === 'number' && Number.isFinite(n)).map((n) => Math.floor(n)),
  );
  let candidate = Math.max(1, Math.floor(base) || 1);
  while (candidate < 65536) {
    if (!taken.has(candidate)) return candidate;
    candidate += 1;
  }
  throw new Error('No free port available');
}

/**
 * TCP connect probe against 127.0.0.1.
 * @param {number} port
 * @returns {Promise<'in-use' | 'free'>}
 */
export function probePort(port) {
  const p = Math.floor(Number(port));
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    return Promise.resolve('free');
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: p });
    let settled = false;
    const finish = (/** @type {'in-use' | 'free'} */ result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish('free'), PROBE_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish('in-use');
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish('free');
    });
  });
}

/**
 * Parse Windows `netstat -ano` LISTENING lines.
 * @param {string} stdout
 * @returns {{ port: number, address: string, pid: number }[]}
 */
export function parseNetstatListening(stdout) {
  /** @type {{ port: number, address: string, pid: number }[]} */
  const rows = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/LISTENING/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1];
    const pidStr = parts[parts.length - 1];
    const pid = Number(pidStr);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const portMatch = local.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    if (!Number.isFinite(port)) continue;
    const address = local.slice(0, local.length - portMatch[0].length) || local;
    rows.push({ port, address, pid });
  }
  return rows;
}

/**
 * Parse `lsof -nP -iTCP -sTCP:LISTEN` output.
 * @param {string} stdout
 * @returns {{ port: number, address: string, pid: number, process: string }[]}
 */
export function parseLsofListening(stdout) {
  /** @type {{ port: number, address: string, pid: number, process: string }[]} */
  const rows = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim() || /^COMMAND\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const processName = parts[0];
    const pid = Number(parts[1]);
    const nameField = parts.slice(8).join(' ') || parts[parts.length - 1];
    const m = nameField.match(/([^:\s]+):(\d+)/);
    if (!m || !Number.isFinite(pid) || pid <= 0) continue;
    rows.push({
      process: processName,
      pid,
      address: m[1] === '*' ? '0.0.0.0' : m[1],
      port: Number(m[2]),
    });
  }
  return rows;
}

/**
 * Parse `tasklist /fo csv /nh` into pid → image name.
 * @param {string} stdout
 * @returns {Map<number, string>}
 */
export function parseTasklistCsv(stdout) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^"([^"]+)","(\d+)"/);
    if (!match) continue;
    map.set(Number(match[2]), match[1]);
  }
  return map;
}

/**
 * @returns {Promise<ListeningPortRow[]>}
 */
export async function listListeningPorts() {
  if (listCache && Date.now() - listCache.at < LIST_CACHE_MS) {
    return listCache.rows;
  }

  try {
    /** @type {ListeningPortRow[]} */
    let rows = [];
    if (process.platform === 'win32') {
      const netstat = await runProcess('netstat', ['-ano'], { timeout: LIST_TIMEOUT_MS });
      const parsed = parseNetstatListening(netstat.stdout);
      let names = new Map();
      try {
        const tasklist = await runProcess('tasklist', ['/fo', 'csv', '/nh'], {
          timeout: LIST_TIMEOUT_MS,
        });
        names = parseTasklistCsv(tasklist.stdout);
      } catch {
        names = new Map();
      }
      rows = parsed.map((r) => ({
        port: r.port,
        address: r.address,
        pid: r.pid,
        process: names.get(r.pid) ?? 'unknown',
        protected: isProtectedPortOwner(r.pid, r.port),
      }));
    } else {
      const lsof = await runProcess(
        'lsof',
        ['-nP', '-iTCP', '-sTCP:LISTEN'],
        { timeout: LIST_TIMEOUT_MS },
      );
      rows = parseLsofListening(lsof.stdout).map((r) => ({
        port: r.port,
        address: r.address,
        pid: r.pid,
        process: r.process,
        protected: isProtectedPortOwner(r.pid, r.port),
      }));
    }

    const seen = new Set();
    rows = rows.filter((r) => {
      const key = `${r.port}:${r.pid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    listCache = { at: Date.now(), rows };
    return rows;
  } catch {
    listCache = { at: Date.now(), rows: [] };
    return [];
  }
}

/**
 * Kill the process tree owning a listening port (guarded).
 * @param {number} pid
 * @param {number} [port]
 */
export async function killPortOwner(pid, port) {
  const nPid = Math.floor(Number(pid));
  const nPort = port != null ? Math.floor(Number(port)) : undefined;
  if (!Number.isFinite(nPid) || nPid <= 0) {
    return { ok: false, error: 'pid is required' };
  }
  const blocked = assessPortOwnerKill(nPid, nPort);
  if (blocked) return { ok: false, error: blocked };

  try {
    if (process.platform === 'win32') {
      await runProcess('taskkill', ['/pid', String(nPid), '/T', '/F'], {
        timeout: LIST_TIMEOUT_MS,
      });
    } else {
      try {
        process.kill(nPid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      try {
        process.kill(-nPid, 'SIGKILL');
      } catch {
        try {
          process.kill(nPid, 'SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
    listCache = null;
    return { ok: true, pid: nPid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Test helper: drop the short-lived listing cache. */
export function resetPortsCacheForTests() {
  listCache = null;
}
