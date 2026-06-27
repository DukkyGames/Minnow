/**
 * Synchronous crash log for Electron main + renderer diagnostics.
 * Self-contained — no imports from server/ so crash handlers work pre-bootstrap.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/** One crash record written to crash.jsonl and optional last-crash.json. */
export type CrashEntry = {
  kind: string;
  reason?: string;
  exitCode?: number;
  stack?: string;
  message?: string;
  source?: 'main' | 'renderer' | 'child';
  extra?: Record<string, unknown>;
};

/** Persisted line in crash.jsonl. */
export type CrashLogLine = CrashEntry & {
  ts: string;
  pid: number;
};

/** Marker left when the renderer process dies (read on next boot). */
export type LastCrashMarker = {
  kind: string;
  reason?: string;
  exitCode?: number;
  message?: string;
  ts: string;
};

const CRASH_LOG_FILE = 'crash.jsonl';
const LAST_CRASH_FILE = 'last-crash.json';
const OOM_PAUSE_FILE = 'oom-pause.json';

/** How long OOM throttling / pause-on-resume stays active after a renderer OOM kill. */
export const OOM_PAUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

let cachedLogDir: string | null = null;

/** Lines queued for the next async flush. */
let crashBuffer: string[] = [];
let crashFlushTimer: ReturnType<typeof setTimeout> | undefined;
const CRASH_FLUSH_DELAY_MS = 50;

function scheduleCrashFlush(): void {
  if (crashFlushTimer !== undefined) return;
  crashFlushTimer = setTimeout(() => {
    crashFlushTimer = undefined;
    const lines = crashBuffer.splice(0);
    if (!lines.length) return;
    fs.appendFile(crashLogPath(), lines.join(''), 'utf8', () => {/* best-effort */});
  }, CRASH_FLUSH_DELAY_MS);
}

/**
 * Drain any buffered crash lines synchronously. Call from process-death handlers
 * (uncaughtException, unresponsive) to ensure queued records are not lost before exit.
 */
export function flushCrashLogSync(): void {
  if (crashFlushTimer !== undefined) {
    clearTimeout(crashFlushTimer);
    crashFlushTimer = undefined;
  }
  const lines = crashBuffer.splice(0);
  if (!lines.length) return;
  try {
    fs.appendFileSync(crashLogPath(), lines.join(''), 'utf8');
  } catch {
    /* last resort */
  }
}

/** Reset cached log dir (tests only). */
export function resetCrashLogDirCache(): void {
  cachedLogDir = null;
}

/** Best-effort Electron app.getPath without requiring a live app instance. */
function tryElectronLogsPath(): string | null {
  try {
    if (!process.versions.electron) return null;
    const req = createRequire(import.meta.url);
    const { app } = req('electron') as { app?: { getPath?: (name: string) => string } };
    if (typeof app?.getPath === 'function') {
      return app.getPath('logs');
    }
  } catch {
    /* no electron in plain node:test */
  }
  return null;
}

/**
 * Resolve ~/.minnow/logs (or MINNOW_HOME/logs).
 * Order: explicit override → MINNOW_HOME → ~/.minnow → Electron app logs.
 */
export function resolveCrashLogDir(opts?: { override?: string }): string {
  if (cachedLogDir) return cachedLogDir;

  const explicit = opts?.override?.trim();
  if (explicit) {
    cachedLogDir = path.resolve(explicit);
    ensureDir(cachedLogDir);
    return cachedLogDir;
  }

  const homeOverride =
    typeof process.env.MINNOW_HOME === 'string' && process.env.MINNOW_HOME.trim()
      ? process.env.MINNOW_HOME.trim()
      : '';
  if (homeOverride) {
    cachedLogDir = path.join(path.resolve(homeOverride), 'logs');
    ensureDir(cachedLogDir);
    return cachedLogDir;
  }

  const homedir = os.homedir();
  if (homedir) {
    cachedLogDir = path.join(homedir, '.minnow', 'logs');
  } else {
    cachedLogDir = tryElectronLogsPath() ?? path.join(os.tmpdir(), '.minnow', 'logs');
  }
  ensureDir(cachedLogDir);
  return cachedLogDir;
}

/** Create log directory; never throw from crash-path resolution. */
function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore — append will no-op in try/catch */
  }
}

function crashLogPath(): string {
  return path.join(resolveCrashLogDir(), CRASH_LOG_FILE);
}

function lastCrashPath(): string {
  return path.join(resolveCrashLogDir(), LAST_CRASH_FILE);
}

function oomPausePath(): string {
  return path.join(resolveCrashLogDir(), OOM_PAUSE_FILE);
}

/**
 * Queue one crash line for async flush to crash.jsonl.
 * Never throws — crash handlers may run while the process is dying.
 * Call flushCrashLogSync() before process exit to drain the buffer.
 */
export function logCrash(entry: CrashEntry): void {
  try {
    const line: CrashLogLine = {
      ts: new Date().toISOString(),
      pid: process.pid,
      ...entry,
    };
    crashBuffer.push(`${JSON.stringify(line)}\n`);
    scheduleCrashFlush();
  } catch {
    /* last resort — cannot recover if disk is full or path invalid */
  }
}

/** Write marker for renderer crash recovery on next load. */
export function writeLastCrashMarker(entry: Omit<LastCrashMarker, 'ts'> & { ts?: string }): void {
  try {
    const marker: LastCrashMarker = {
      ts: entry.ts ?? new Date().toISOString(),
      kind: entry.kind,
      reason: entry.reason,
      exitCode: entry.exitCode,
      message: entry.message,
    };
    fs.writeFileSync(lastCrashPath(), JSON.stringify(marker), 'utf8');
  } catch {
    /* ignore */
  }
}

/** Read last crash marker if present. */
export function readLastCrashMarker(): LastCrashMarker | null {
  try {
    const raw = fs.readFileSync(lastCrashPath(), 'utf8');
    const parsed = JSON.parse(raw) as LastCrashMarker;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

/** Remove last-crash marker (ENOENT is fine). */
export function clearLastCrashMarker(): void {
  try {
    fs.unlinkSync(lastCrashPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      /* ignore other errors during cleanup */
    }
  }
}

/** Persist OOM marker so the renderer can pause AFK boards on next boot. */
export function writeOomPauseMarker(entry?: { ts?: string }): void {
  try {
    const marker: LastCrashMarker = {
      ts: entry?.ts ?? new Date().toISOString(),
      kind: 'render-process-gone',
      reason: 'oom',
      message: 'Renderer process ran out of memory',
    };
    fs.writeFileSync(oomPausePath(), JSON.stringify(marker), 'utf8');
  } catch {
    /* ignore */
  }
}

/** Read OOM pause marker when still inside the retention window. */
export function readOomPauseMarker(nowMs = Date.now()): LastCrashMarker | null {
  try {
    const raw = fs.readFileSync(oomPausePath(), 'utf8');
    const parsed = JSON.parse(raw) as LastCrashMarker;
    if (!parsed || typeof parsed !== 'object' || parsed.reason !== 'oom') return null;
    const ts = Date.parse(parsed.ts);
    if (!Number.isFinite(ts) || nowMs - ts > OOM_PAUSE_WINDOW_MS) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

/** Clear OOM pause marker after the user explicitly resumes the board. */
export function clearOomPauseMarker(): void {
  try {
    fs.unlinkSync(oomPausePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      /* ignore */
    }
  }
}
