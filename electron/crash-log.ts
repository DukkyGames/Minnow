import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

export type CrashEntry = {
  kind: string;
  reason?: string;
  exitCode?: number;
  stack?: string;
  message?: string;
  source?: 'main' | 'renderer' | 'child';
  extra?: Record<string, unknown>;
};

export type CrashLogLine = CrashEntry & {
  ts: string;
  pid: number;
};

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

export const OOM_PAUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

let cachedLogDir: string | null = null;

let crashBuffer: string[] = [];
let crashFlushTimer: ReturnType<typeof setTimeout> | undefined;
const CRASH_FLUSH_DELAY_MS = 50;

// ── Flush buffer ─────────────────────────────────────────────────────────────

function scheduleCrashFlush(): void {
  if (crashFlushTimer !== undefined) return;
  crashFlushTimer = setTimeout(() => {
    crashFlushTimer = undefined;
    const lines = crashBuffer.splice(0);
    if (!lines.length) return;
    fs.appendFile(crashLogPath(), lines.join(''), 'utf8', () => {});
  }, CRASH_FLUSH_DELAY_MS);
}

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
  }
}

export function resetCrashLogDirCache(): void {
  cachedLogDir = null;
}

// ── Log paths ────────────────────────────────────────────────────────────────

function tryElectronLogsPath(): string | null {
  try {
    if (!process.versions.electron) return null;
    const req = createRequire(import.meta.url);
    const { app } = req('electron') as { app?: { getPath?: (name: string) => string } };
    if (typeof app?.getPath === 'function') {
      return app.getPath('logs');
    }
  } catch {
  }
  return null;
}

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

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
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

// ── Crash log ────────────────────────────────────────────────────────────────

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
  }
}

// ── Last crash ───────────────────────────────────────────────────────────────

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
  }
}

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

export function clearLastCrashMarker(): void {
  try {
    fs.unlinkSync(lastCrashPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    }
  }
}

// ── OOM pause ────────────────────────────────────────────────────────────────

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
  }
}

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

export function clearOomPauseMarker(): void {
  try {
    fs.unlinkSync(oomPausePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    }
  }
}
