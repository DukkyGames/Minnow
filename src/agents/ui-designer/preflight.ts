import type { UiDesignerMode } from './constants';

export interface PreflightGateState {
  context?: 'pass' | 'fail';
  product?: 'pass' | 'fail';
  commandReference?: 'pass' | 'not_required';
  shape?: 'pass' | 'not_required';
  imageGate?: string;
  mutation?: 'open' | 'closed';
}

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

export const UI_DESIGNER_PREFLIGHT_INSTRUCTION = [
  'Before any UI file mutation, emit exactly one line:',
  'IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass|not_required image_gate=pass|skipped:<reason> mutation=open|closed',
  '',
  'Load design context first:',
  'load_impeccable_context (server tool — works when workspace is not the Minnow repo)',
  '',
  'Harness flow: /impeccable <cmd> (e.g. teach, audit, shape, craft, polish) — references are auto-injected on send; /impeccable craft also includes shape.md.',
  'CLI/scripts only: run_impeccable with command detect or live (anti-pattern scan, live HMR). Do not use run_impeccable or npx impeccable for teach, audit, shape, craft, etc.',
].join('\n');
