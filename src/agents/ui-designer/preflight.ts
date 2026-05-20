/**
 * Impeccable preflight instruction line for UI Designer turns (Step 15).
 */

import type { UiDesignerMode } from './constants';

export interface PreflightGateState {
  context?: 'pass' | 'fail';
  product?: 'pass' | 'fail';
  commandReference?: 'pass' | 'not_required';
  shape?: 'pass' | 'not_required';
  imageGate?: string;
  mutation?: 'open' | 'closed';
}

/** Build the IMPECCABLE_PREFLIGHT status line required before edits. */
export function formatImpeccablePreflightLine(
  gates: PreflightGateState,
  mode: UiDesignerMode,
): string {
  const context = gates.context ?? 'pass';
  const product = gates.product ?? 'pass';
  const commandReference = gates.commandReference ?? 'pass';
  const shape = gates.shape ?? (mode === 'plan' ? 'not_required' : 'pass');
  const imageGate = gates.imageGate ?? (mode === 'plan' ? 'skipped:plan_mode' : 'pass');
  const mutation = gates.mutation ?? (mode === 'plan' ? 'closed' : 'open');

  return [
    'IMPECCABLE_PREFLIGHT:',
    `context=${context}`,
    `product=${product}`,
    `command_reference=${commandReference}`,
    `shape=${shape}`,
    `image_gate=${imageGate}`,
    `mutation=${mutation}`,
  ].join(' ');
}

/** Static instruction block appended to skill / work-agent context. */
export const UI_DESIGNER_PREFLIGHT_INSTRUCTION = [
  'Before any UI file mutation, emit exactly one line:',
  'IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass|not_required image_gate=pass|skipped:<reason> mutation=open|closed',
  '',
  'Load design context first:',
  'load_impeccable_context (server tool — works when workspace is not the Minnow repo)',
  '',
  'Delegate Impeccable sub-commands via run_impeccable (audit, shape, craft, polish) or documented /impeccable flow.',
].join('\n');
