/**
 * Read and aggregate local diagnostic entries from JSONL logs.
 */

import { readDiagnosticEntries } from './ring-log.js';
import { redactDiagnosticValue } from './redact.js';

/** Extract first stack frame for stable grouping keys. */
export function firstStackFrame(stack) {
  if (!stack || typeof stack !== 'string') return '';
  const line = stack.split('\n').find((l) => l.trim().startsWith('at '));
  return line?.trim() ?? '';
}

/**
 * Build a dedupe signature for one error entry.
 * @param {Record<string, unknown>} entry
 */
export function buildErrorSignature(entry) {
  const kind = String(entry.kind ?? 'error');
  const message = String(entry.message ?? '').slice(0, 200);
  const source = String(entry.source ?? 'unknown');
  const frame = firstStackFrame(typeof entry.stack === 'string' ? entry.stack : '');
  return `${source}|${kind}|${message}|${frame}`;
}

/**
 * Map source field to filter bucket (renderer/server/electron).
 * @param {Record<string, unknown>} entry
 */
export function classifyDiagnosticSource(entry) {
  const source = String(entry.source ?? '').toLowerCase();
  if (source === 'renderer') return 'renderer';
  if (source === 'main' || source === 'child') return 'electron';
  return 'server';
}

/**
 * Group entries by signature with counts and last-seen metadata.
 * @param {Array<Record<string, unknown>>} entries
 */
export function groupDiagnosticErrors(entries) {
  /** @type {Map<string, { signature: string; count: number; lastAt: string; source: string; kind: string; message: string; stack?: string; sample: Record<string, unknown> }>} */
  const groups = new Map();

  for (const entry of entries) {
    const signature = buildErrorSignature(entry);
    const existing = groups.get(signature);
    const ts = String(entry.ts ?? '');
    if (existing) {
      existing.count += 1;
      if (ts && (!existing.lastAt || ts > existing.lastAt)) {
        existing.lastAt = ts;
        existing.sample = entry;
        if (typeof entry.stack === 'string') existing.stack = entry.stack;
      }
    } else {
      groups.set(signature, {
        signature,
        count: 1,
        lastAt: ts,
        source: classifyDiagnosticSource(entry),
        kind: String(entry.kind ?? 'error'),
        message: String(entry.message ?? ''),
        stack: typeof entry.stack === 'string' ? entry.stack : undefined,
        sample: entry,
      });
    }
  }

  return [...groups.values()].sort((a, b) => {
    const ta = Date.parse(a.lastAt);
    const tb = Date.parse(b.lastAt);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

/**
 * Load recent errors, optionally filtered by source bucket.
 * @param {{ maxLines?: number; source?: 'renderer' | 'server' | 'electron' | 'all'; redact?: boolean; override?: string }} [opts]
 */
export async function loadGroupedErrors(opts) {
  const entries = await readDiagnosticEntries({
    maxLines: opts?.maxLines ?? 500,
    override: opts?.override,
  });

  const errorKinds = new Set([
    'uncaught-error',
    'unhandled-rejection',
    'uncaughtException',
    'unhandledRejection',
    'render-process-gone',
    'child-process-gone',
    'bootstrap-failed',
    'server-error',
    'middleware-error',
    'pty-exit',
    'lsp-exit',
    'voice-worker-exit',
    'voice-worker-error',
    'renderer-error',
  ]);

  const errors = entries.filter((entry) => {
    const kind = String(entry.kind ?? '');
    if (!errorKinds.has(kind) && !kind.includes('error') && !kind.includes('gone')) {
      return false;
    }
    if (!opts?.source || opts.source === 'all') return true;
    return classifyDiagnosticSource(entry) === opts.source;
  });

  const grouped = groupDiagnosticErrors(errors);
  if (!opts?.redact) return grouped;
  return grouped.map((g) => redactDiagnosticValue(g));
}

/**
 * Tail log lines for the viewer, optionally filtered by source.
 * @param {{ maxLines?: number; source?: string; override?: string; redact?: boolean }} [opts]
 */
export async function loadDiagnosticLogTail(opts) {
  const entries = await readDiagnosticEntries({
    maxLines: opts?.maxLines ?? 100,
    override: opts?.override,
  });

  let filtered = entries;
  if (opts?.source && opts.source !== 'all') {
    filtered = entries.filter(
      (entry) => classifyDiagnosticSource(entry) === opts.source,
    );
  }

  const tail = filtered.slice(-(opts?.maxLines ?? 100));
  if (!opts?.redact) return tail;
  return tail.map((e) => redactDiagnosticValue(e));
}
