/**
 * Capability matrix catalog types (Settings → Advanced → Capability matrix).
 */

/** Spreadsheet band ids — 14 groups in column order. */
export type CapabilityGroupId =
  | 'core-protocol'
  | 'files'
  | 'docs'
  | 'git'
  | 'code-shell'
  | 'lsp'
  | 'web'
  | 'browser'
  | 'agents-tasks'
  | 'knowledge'
  | 'apps'
  | 'mode-control'
  | 'modes'
  | 'features';

export type CapabilityScoreMode = 'auto' | 'manual';

export type CapabilityVerdict = 'pass' | 'partial' | 'fail' | 'n-a' | 'untested';

/** Scored verdicts included in the spreadsheet formula (excludes n-a and untested). */
export type CapabilityScoredVerdict = 'pass' | 'partial' | 'fail';

export type CapabilityProbeKind =
  | 'text'
  | 'stream'
  | 'tool-call'
  | 'tool-chain'
  | 'derived'
  | 'delegated';

/** Per-round telemetry for parallel-tool and json-args probes (Phase 2 driver). */
export interface CapabilityRoundTelemetry {
  round: number;
  toolCalls: CapabilityToolCall[];
}

export interface CapabilityToolCall {
  function: { name: string; arguments: string };
}

/** Output passed to probe verdict functions after a headless run. */
export interface CapabilityProbeRunOutput {
  text: string;
  streamChunkCount?: number;
  toolCalls: CapabilityToolCall[];
  rounds: CapabilityRoundTelemetry[];
  executedResults?: string[];
}

export interface CapabilityProbeVerdict {
  verdict: CapabilityScoredVerdict;
  reason: string;
}

export type CapabilityProbeRequirement = 'workspace' | 'tool-server' | 'vision' | 'lsp' | 'git-fixture';

export interface CapabilityProbeSpecBase {
  kind: CapabilityProbeKind;
  requires?: CapabilityProbeRequirement[];
  emitOnly?: boolean;
  maxToolRounds?: number;
  toolIds?: string[];
  expectTools?: string[];
  expectArgs?: (args: Record<string, unknown>) => boolean;
  verifyExec?: (result: string) => boolean;
  verdict: (out: CapabilityProbeRunOutput) => CapabilityProbeVerdict;
}

export interface DelegatedCapabilityProbeSpec {
  kind: 'delegated';
  suiteId: string;
  testId: string;
  requires?: CapabilityProbeRequirement[];
}

export type CapabilityProbeSpec = CapabilityProbeSpecBase | DelegatedCapabilityProbeSpec;

export interface CapabilityDefinition {
  id: string;
  group: CapabilityGroupId;
  header: string;
  tier: 1 | 2 | 3;
  scoreMode: CapabilityScoreMode;
  howToTest: string;
  setup: string;
  prompt: string;
  passCriteria: string;
  probe?: CapabilityProbeSpec;
  manualReason?: string;
}
