/**
 * LSP signature help shown after `(` and `,`.
 */

import { StateEffect, StateField, Prec, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view';
import { fetchLspSignature, type LspSignatureHelp } from '../../lsp/completion-client';
import { offsetToLspPosition } from './lsp-positions';

const setSignatureTooltipEffect = StateEffect.define<Tooltip | null>();

const signatureTooltipField = StateField.define<readonly Tooltip[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSignatureTooltipEffect)) {
        return effect.value ? [effect.value] : [];
      }
    }
    return value;
  },
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
});

function signatureHelpToHtml(help: LspSignatureHelp): string {
  const signatures = help.signatures ?? [];
  if (signatures.length === 0) return '';
  const idx = help.activeSignature ?? 0;
  const sig = signatures[Math.min(idx, signatures.length - 1)];
  const label = sig?.label ?? '';
  const activeParam = help.activeParameter ?? 0;
  const params = sig?.parameters ?? [];
  if (params.length === 0) {
    return escapeHtml(label);
  }
  const parts = params.map((p, i) => {
    const paramLabel =
      typeof p.label === 'string'
        ? p.label
        : Array.isArray(p.label)
          ? label.slice(p.label[0], p.label[1])
          : '';
    const cls = i === activeParam ? 'cm-lsp-signature-param--active' : '';
    return `<span class="${cls}">${escapeHtml(paramLabel)}</span>`;
  });
  return `<span class="cm-lsp-signature-label">${escapeHtml(label)}</span><span class="cm-lsp-signature-params">(${parts.join(', ')})</span>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shouldRequestSignature(ch: string): boolean {
  return ch === '(' || ch === ',';
}

/** Signature help tooltip on `(` and `,`. */
export function lspSignatureExtensions(filePath: string): Extension[] {
  const signatureTrigger = EditorView.inputHandler.of((view, _from, to, text) => {
    if (!shouldRequestSignature(text)) return false;
    const pos = to;
    const lspPos = offsetToLspPosition(view, pos);
    void fetchLspSignature(filePath, lspPos.line, lspPos.character).then((help) => {
      if (!help?.signatures?.length) {
        view.dispatch({ effects: setSignatureTooltipEffect.of(null) });
        return;
      }
      const html = signatureHelpToHtml(help);
      if (!html) return;
      const tooltip: Tooltip = {
        pos,
        above: true,
        strictSide: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-lsp-signature';
          dom.innerHTML = html;
          return { dom };
        },
      };
      view.dispatch({ effects: setSignatureTooltipEffect.of(tooltip) });
    });
    return false;
  });

  return [signatureTooltipField, Prec.low(signatureTrigger)];
}
