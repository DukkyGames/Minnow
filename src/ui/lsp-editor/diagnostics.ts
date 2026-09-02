import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import {
  fetchLspDiagnostics,
  type LspStructuredDiagnostic,
} from '../../lsp/completion-client';
import { lspRangeToSpan } from './lsp-positions';

export interface LspDiagnosticCounts {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
}

let diagnosticsChromeListener: ((counts: LspDiagnosticCounts) => void) | null = null;

/** Register a callback for footer chrome (error/warning counts). */
export function setLspDiagnosticsChromeListener(
  listener: ((counts: LspDiagnosticCounts) => void) | null,
): void {
  diagnosticsChromeListener = listener;
}

function mapSeverity(severity: number): Diagnostic['severity'] {
  if (severity === 2) return 'warning';
  if (severity === 3) return 'info';
  if (severity === 4) return 'hint';
  return 'error';
}

function countDiagnostics(diags: LspStructuredDiagnostic[]): LspDiagnosticCounts {
  const counts: LspDiagnosticCounts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const d of diags) {
    if (d.severity === 2) counts.warnings += 1;
    else if (d.severity === 3) counts.infos += 1;
    else if (d.severity === 4) counts.hints += 1;
    else counts.errors += 1;
  }
  return counts;
}

function toCmDiagnostics(
  view: import('@codemirror/view').EditorView,
  diags: LspStructuredDiagnostic[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of diags) {
    if (!d.range) continue;
    const { from, to } = lspRangeToSpan(view, d.range);
    if (from > to) continue;
    const source = d.source ? ` (${d.source})` : '';
    out.push({
      from,
      to: Math.max(from, to),
      severity: mapSeverity(d.severity),
      message: `${d.message ?? 'unknown'}${source}`,
    });
  }
  return out;
}

/**
 * Async linter that pulls structured diagnostics from POST /api/lsp/diagnostics-structured.
 */
export function lspDiagnosticsExtensions(filePath: string): Extension[] {
  const lspLinter = linter(
    async (view) => {
      const raw = await fetchLspDiagnostics(filePath, view.state.doc.toString());
      const counts = countDiagnostics(raw);
      diagnosticsChromeListener?.(counts);
      return toCmDiagnostics(view, raw);
    },
    { delay: 400 },
  );

  return [lintGutter(), lspLinter];
}
