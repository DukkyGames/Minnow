/**
 * P5-A — Browser process lifecycle (MIN-719).
 *
 * Launch, health check, supervised kill, and an orphan registry drained when the
 * host exits. Everything here is written to one rule: **a hung or crashed
 * browser must never hang or crash the engine.** Every wait has a deadline,
 * every deadline ends in a kill, and a kill is idempotent.
 *
 * Port discovery is by inspection, not assumption: Chromium is launched with
 * `--remote-debugging-port=0` and writes the real port into
 * `<profileDir>/DevToolsActivePort`, which we poll for.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {object} BrowserProcessHandle
 * @property {import('node:child_process').ChildProcess} child
 * @property {number} pid
 * @property {number} port
 * @property {string} browserWsUrl
 * @property {string} profileDir
 * @property {string} executablePath
 */

/**
 * Every browser this process launched and has not confirmed dead.
 * Drained on host exit so a crashed engine cannot leave a browser running.
 * @type {Set<{ pid: number, profileDir: string }>}
 */
const liveBrowsers = new Set();

let exitHookInstalled = false;

/** Best-effort synchronous teardown — only safe work allowed on `exit`. */
function drainOnExit() {
  for (const entry of liveBrowsers) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(entry.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 4000,
        });
      } else {
        try {
          process.kill(-entry.pid, 'SIGKILL');
        } catch {
          process.kill(entry.pid, 'SIGKILL');
        }
      }
    } catch {
      /* already gone */
    }
  }
  liveBrowsers.clear();
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', drainOnExit);
}

/** Test/inspection hook: pids the driver still believes are alive. */
export function trackedBrowserPids() {
  return [...liveBrowsers].map((e) => e.pid);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * Poll `<profileDir>/DevToolsActivePort` until the browser writes it.
 *
 * The file is two lines: the port, then the browser-target WS path.
 *
 * @param {string} profileDir
 * @param {number} timeoutMs
 * @param {() => boolean} hasExited
 * @returns {Promise<{ port: number, wsPath: string }>}
 */
async function readDevToolsActivePort(profileDir, timeoutMs, hasExited) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not written';
  while (Date.now() < deadline) {
    if (hasExited()) {
      throw new Error('browser exited before it published a debugging port');
    }
    try {
      const raw = await fs.readFile(file, 'utf8');
      const [portLine, wsLine] = raw.split('\n');
      const port = Number(String(portLine ?? '').trim());
      if (Number.isInteger(port) && port > 0) {
        return { port, wsPath: String(wsLine ?? '').trim() };
      }
      lastError = 'file present but port line unparseable';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(50);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for DevToolsActivePort (${lastError})`);
}

/**
 * HTTP health check against the DevTools endpoint.
 *
 * Used both as the post-launch readiness gate and as the "is the browser itself
 * hung, or is only the page slow?" probe. Has its own AbortSignal deadline so it
 * can never be the thing that hangs.
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: true, version: string, browserWsUrl: string } | { ok: false, error: string }>}
 */
export async function checkBrowserHealth(port, timeoutMs = 5_000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = /** @type {Record<string, unknown>} */ (await res.json());
    return {
      ok: true,
      version: String(body.Browser ?? 'unknown'),
      browserWsUrl: String(body.webSocketDebuggerUrl ?? ''),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * List DevTools targets.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<Array<{ id: string, type: string, title: string, url: string, webSocketDebuggerUrl: string }>>}
 */
export async function listTargets(port, timeoutMs = 5_000) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`failed to list targets: HTTP ${res.status}`);
  return /** @type {any} */ (await res.json());
}

/**
 * Spawn a browser and wait until its DevTools endpoint answers.
 *
 * Rejects (after cleaning up the process) rather than returning a half-live
 * handle. Callers translate that into a capability report.
 *
 * @param {object} input
 * @param {string} input.executablePath
 * @param {string} input.profileDir
 * @param {string[]} input.args
 * @param {number} input.launchTimeoutMs
 * @param {(reason: string) => void} [input.onExit] fired when the browser dies unprompted
 * @returns {Promise<BrowserProcessHandle>}
 */
export async function launchBrowserProcess(input) {
  installExitHook();

  const child = spawn(input.executablePath, input.args, {
    windowsHide: true,
    // Own process group on posix so a supervised kill can take the whole tree.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /** @type {string[]} */
  const stderrTail = [];
  child.stderr?.on('data', (chunk) => {
    stderrTail.push(String(chunk));
    if (stderrTail.length > 40) stderrTail.shift();
  });
  child.stdout?.resume();

  let exited = false;
  /** @type {string | null} */
  let exitReason = null;
  let spawnError = /** @type {Error | null} */ (null);

  child.on('error', (err) => {
    spawnError = err instanceof Error ? err : new Error(String(err));
    exited = true;
    exitReason = `spawn failed: ${spawnError.message}`;
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitReason = `browser exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`;
  });

  const entry = { pid: child.pid ?? -1, profileDir: input.profileDir };
  if (child.pid) liveBrowsers.add(entry);

  const fail = async (/** @type {string} */ message) => {
    liveBrowsers.delete(entry);
    if (!exited) await killBrowserProcess(child, { graceMs: 500 });
    const tail = stderrTail.join('').trim().slice(-1200);
    throw new Error(tail ? `${message}\n--- browser stderr ---\n${tail}` : message);
  };

  /** @type {{ port: number, wsPath: string }} */
  let active;
  try {
    active = await readDevToolsActivePort(input.profileDir, input.launchTimeoutMs, () => exited);
  } catch (err) {
    if (spawnError) {
      liveBrowsers.delete(entry);
      throw spawnError;
    }
    return await fail(err instanceof Error ? err.message : String(err));
  }

  const health = await checkBrowserHealth(active.port, Math.min(input.launchTimeoutMs, 10_000));
  if (!health.ok) {
    return await fail(`browser published port ${active.port} but /json/version failed: ${health.error}`);
  }

  // Late death: once we return, an unprompted exit is the session's problem, not
  // the launcher's. Deregister so the exit hook does not chase a dead pid.
  child.on('exit', () => {
    liveBrowsers.delete(entry);
    input.onExit?.(exitReason ?? 'browser exited');
  });
  if (exited) {
    liveBrowsers.delete(entry);
    return await fail(exitReason ?? 'browser exited during startup');
  }

  return {
    child,
    pid: child.pid ?? -1,
    port: active.port,
    browserWsUrl: health.browserWsUrl || (active.wsPath ? `ws://127.0.0.1:${active.port}${active.wsPath}` : ''),
    profileDir: input.profileDir,
    executablePath: input.executablePath,
  };
}

/**
 * Supervised kill: escalate to a forced tree kill and wait for the exit.
 *
 * Idempotent, never throws, always resolves — a kill that cannot be confirmed
 * resolves `{ killed: false }` rather than leaving the caller waiting. On win32
 * `taskkill /T /F` is the only reliable way to take Chromium's child processes
 * (renderers, GPU, utility) with it.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ graceMs?: number, waitMs?: number }} [opts]
 * @returns {Promise<{ killed: boolean, alreadyDead: boolean }>}
 */
export async function killBrowserProcess(child, opts = {}) {
  const pid = child?.pid;
  if (!pid) return { killed: false, alreadyDead: true };
  if (child.exitCode !== null || child.signalCode !== null) {
    for (const entry of liveBrowsers) if (entry.pid === pid) liveBrowsers.delete(entry);
    return { killed: true, alreadyDead: true };
  }

  const waitMs = opts.waitMs ?? 10_000;
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(true);
    child.once('exit', () => resolve(true));
  });

  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      // Without an error listener an ENOENT here becomes an unhandled 'error'
      // that takes the host down — the exact failure mode this module exists to
      // avoid (see server/terminal-runner.js killProcessTree).
      killer.on('error', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* gone */
        }
      });
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }
  } else {
    const grace = opts.graceMs ?? 2_000;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* gone */
      }
    }
    const gracePassed = await Promise.race([exited, delay(grace).then(() => false)]);
    if (!gracePassed) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
  }

  const confirmed = await Promise.race([exited, delay(waitMs).then(() => false)]);
  for (const entry of liveBrowsers) if (entry.pid === pid) liveBrowsers.delete(entry);
  return { killed: Boolean(confirmed), alreadyDead: false };
}

/**
 * Is a pid still running? Used by tests and the orphan check.
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}
