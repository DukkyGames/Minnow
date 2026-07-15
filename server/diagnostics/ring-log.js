/**
 * Size-capped rotating JSONL log under ~/.minnow/logs/.
 * Serialized writes per path to avoid EMFILE under concurrent append load.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Primary diagnostics log filename. */
export const DIAGNOSTICS_LOG_FILE = 'diagnostics.jsonl';

/** Max bytes per log file before rotation. */
export const DIAGNOSTICS_LOG_MAX_BYTES = 2 * 1024 * 1024;

/** Number of rotated backups to keep (diagnostics.jsonl.1 … .N). */
export const DIAGNOSTICS_LOG_MAX_ROTATIONS = 3;

/** @type {Map<string, Promise<void>>} */
const writeQueues = new Map();

/**
 * Resolve ~/.minnow/logs (or MINNOW_HOME/logs).
 * @param {{ override?: string }} [opts]
 */
export function resolveDiagnosticsLogDir(opts) {
  const explicit = opts?.override?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.join(getMinnowHome(), 'logs');
}

/** Full path to the active diagnostics JSONL file. */
export function diagnosticsLogPath(opts) {
  return path.join(resolveDiagnosticsLogDir(opts), DIAGNOSTICS_LOG_FILE);
}

/**
 * Rotate log when it exceeds the size cap.
 * diagnostics.jsonl → .1 → .2 → … dropping the oldest backup.
 * @param {string} logPath
 */
async function rotateIfNeeded(logPath) {
  let stat;
  try {
    stat = await fsp.stat(logPath);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
    throw err;
  }
  if (stat.size < DIAGNOSTICS_LOG_MAX_BYTES) return;

  const dir = path.dirname(logPath);
  const base = path.basename(logPath);
  const oldest = path.join(dir, `${base}.${DIAGNOSTICS_LOG_MAX_ROTATIONS}`);
  try {
    await fsp.unlink(oldest);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      /* best-effort rotation */
    }
  }

  for (let i = DIAGNOSTICS_LOG_MAX_ROTATIONS - 1; i >= 1; i -= 1) {
    const from = path.join(dir, `${base}.${i}`);
    const to = path.join(dir, `${base}.${i + 1}`);
    try {
      await fsp.rename(from, to);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        /* continue rotation */
      }
    }
  }

  const first = path.join(dir, `${base}.1`);
  try {
    await fsp.rename(logPath, first);
  } catch {
    /* if rename fails, truncate in place */
    await fsp.writeFile(logPath, '', 'utf8');
  }
}

/**
 * Append one JSONL line with serialized per-path queue (EMFILE-safe).
 * @param {Record<string, unknown>} entry
 * @param {{ override?: string }} [opts]
 */
export async function appendDiagnosticEntry(entry, opts) {
  const logPath = diagnosticsLogPath(opts);
  const line = `${JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    ...entry,
  })}\n`;

  const prev = writeQueues.get(logPath) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      await fsp.mkdir(path.dirname(logPath), { recursive: true });
      await rotateIfNeeded(logPath);
      await fsp.appendFile(logPath, line, 'utf8');
    })
    .catch(() => {
      /* never throw from diagnostics logging */
    })
    .finally(() => {
      if (writeQueues.get(logPath) === next) {
        writeQueues.delete(logPath);
      }
    });
  writeQueues.set(logPath, next);
  return next;
}

/**
 * Read tail lines from diagnostics + crash JSONL files (newest last).
 * @param {{ maxLines?: number, override?: string }} [opts]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readDiagnosticEntries(opts) {
  const maxLines = Math.max(1, Math.min(opts?.maxLines ?? 200, 2000));
  const dir = resolveDiagnosticsLogDir(opts);
  const files = [
    path.join(dir, DIAGNOSTICS_LOG_FILE),
    path.join(dir, 'crash.jsonl'),
  ];

  /** @type {Array<Record<string, unknown>>} */
  const entries = [];

  for (const filePath of files) {
    for (let rot = DIAGNOSTICS_LOG_MAX_ROTATIONS; rot >= 0; rot -= 1) {
      const candidate =
        rot === 0 ? filePath : `${filePath}.${rot}`;
      let raw = '';
      try {
        raw = await fsp.readFile(candidate, 'utf8');
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue;
        continue;
      }
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed));
        } catch {
          /* skip malformed lines */
        }
      }
    }
  }

  entries.sort((a, b) => {
    const ta = Date.parse(String(a.ts ?? ''));
    const tb = Date.parse(String(b.ts ?? ''));
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  return entries.slice(-maxLines);
}

/** Log basenames merged by readDiagnosticEntries (active + rotated backups). */
const DIAGNOSTIC_LOG_BASES = [DIAGNOSTICS_LOG_FILE, 'crash.jsonl'];

/**
 * Delete diagnostics + crash JSONL files (active and rotated backups).
 * @param {{ override?: string }} [opts]
 */
export async function clearDiagnosticLogs(opts) {
  const logPath = diagnosticsLogPath(opts);
  const dir = path.dirname(logPath);

  const pending = writeQueues.get(logPath);
  if (pending) {
    await pending.catch(() => {
      /* drain queue before unlink */
    });
  }

  for (const base of DIAGNOSTIC_LOG_BASES) {
    for (let rot = 0; rot <= DIAGNOSTICS_LOG_MAX_ROTATIONS; rot += 1) {
      const candidate =
        rot === 0 ? path.join(dir, base) : path.join(dir, `${base}.${rot}`);
      try {
        await fsp.unlink(candidate);
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
          /* best-effort clear */
        }
      }
    }
  }
}

/** Reset write queues (tests only). */
export function resetDiagnosticWriteQueuesForTests() {
  writeQueues.clear();
}
