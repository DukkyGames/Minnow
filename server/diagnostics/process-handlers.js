/**
 * Process-level error capture for the Node tool server (non-Electron runs).
 */

import { appendDiagnosticEntry } from './ring-log.js';

let installed = false;

/**
 * Log structured entries for uncaught errors; keep the process alive where safe.
 */
export function installDiagnosticsProcessHandlers() {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (err) => {
    void appendDiagnosticEntry({
      source: 'server',
      kind: 'uncaughtException',
      message: err?.message ?? String(err),
      stack: err?.stack,
    });
    console.error('[diagnostics] uncaughtException:', err);
  });

  process.on('unhandledRejection', (reason) => {
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    void appendDiagnosticEntry({
      source: 'server',
      kind: 'unhandledRejection',
      message,
      stack,
    });
    console.error('[diagnostics] unhandledRejection:', reason);
  });
}

/**
 * Log a child-process or subsystem exit to diagnostics JSONL.
 * @param {Record<string, unknown>} entry
 */
export function logChildProcessDiagnostic(entry) {
  return appendDiagnosticEntry({
    source: 'server',
    ...entry,
  });
}

/**
 * Log a renderer-reported error (browser tab or forwarded from Electron preload).
 * @param {Record<string, unknown>} entry
 */
export function logRendererDiagnostic(entry) {
  return appendDiagnosticEntry({
    source: 'renderer',
    ...entry,
  });
}

/** Reset install guard (tests only). */
export function resetDiagnosticsProcessHandlersForTests() {
  installed = false;
}
