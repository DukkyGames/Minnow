/**
 * Capability matrix catalog types (Settings → Advanced → Capability matrix).
 */

import type { ModeId } from '../../chat/modes/types.ts';

/** Spreadsheet band ids — 13 groups in column order. */
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
  /** Assistant content, falling back to the reasoning channel when content is empty. */
  text: string;
  /** Main assistant `content` only — use for output-shape checks. */
  contentText: string;
  /** Reasoning / thinking channel text when the provider emits it separately. */
  reasoningText: string;
  streamChunkCount?: number;
  toolCalls: CapabilityToolCall[];
  rounds: CapabilityRoundTelemetry[];
  /** Tool result strings in execution order (stubbed results included). */
  executedResults: string[];
  /** Tool names actually offered to the model this run (hallucination check). */
  offeredToolNames: string[];
}

export interface CapabilityProbeVerdict {
  verdict: CapabilityScoredVerdict;
  reason: string;
}

export type CapabilityProbeRequirement =
  | 'workspace'
  | 'tool-server'
  | 'vision'
  | 'lsp'
  | 'git-fixture'
  | 'mode-prompt';

export interface CapabilityProbeSpecBase {
  kind: CapabilityProbeKind;
  requires?: CapabilityProbeRequirement[];
  /** Tools are stubbed rather than executed unless `allowSideEffects` is set. */
  emitOnly?: boolean;
  maxToolRounds?: number;
  /** Tool ids offered to the model; must all exist in the built-in catalog. */
  toolIds?: string[];
  /**
   * Prepend this mode's system prompt (modes band). Pair with the `mode-prompt`
   * requirement so the row goes n-a when the prompt registry is unavailable.
   */
  modeId?: ModeId;
  /**
   * Tools this mode denies, offered on purpose to see whether the model reaches for
   * them anyway. Excluded from the "probe tools match mode policy" test.
   */
  trapToolIds?: string[];
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
