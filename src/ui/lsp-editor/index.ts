/**
 * CodeMirror 6 extensions for in-editor LSP UX (Phase 2).
 */

import type { Extension } from '@codemirror/state';
import { lspDefinitionExtensions } from './definition';
import { lspDiagnosticsExtensions } from './diagnostics';
import { lspHoverExtensions } from './hover';
import { lspSignatureExtensions } from './signature';

export { setLspDiagnosticsChromeListener, type LspDiagnosticCounts } from './diagnostics';

/** Hover, diagnostics, signature help, and go-to-definition for one file path. */
export function lspEditorUxExtensions(filePath: string): Extension[] {
  return [
    ...lspDiagnosticsExtensions(filePath),
    ...lspHoverExtensions(filePath),
    ...lspSignatureExtensions(filePath),
    ...lspDefinitionExtensions(filePath),
  ];
}
