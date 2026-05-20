/**
 * Sub-agent orchestration types (Step 09).
 */

import type { ApiMessage } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';

/** Lifecycle status for a sub-agent run. */
export type SubAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Per-type configuration merged from defaults and ~/.minnow/sub-agents.json. */
export interface SubAgentTypeConfig {
  label?: string;
  enabled: boolean;
  providerId: string;
  modelId: string;
  maxConcurrent: number;
  timeoutMs: number;
  workAgentId: string | null;
  allowedTools: string[] | null;
  deniedTools: string[];
  systemPromptPath: string | null;
}

/** Root sub-agents.json shape (user + merged). */
export interface SubAgentsFile {
  version: number;
  enabled: boolean;
  globalMaxConcurrent: number;
  defaultTimeoutMs: number;
  types: Record<string, SubAgentTypeConfig>;
}

/** One orchestrated sub-agent execution. */
export interface SubAgentRun {
  runId: string;
  type: string;
  task: string;
  status: SubAgentStatus;
  parentTurnId: string | null;
  summary: string;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  toolTurns: number;
  cancelled: boolean;
  messages: ApiMessage[];
}

/** Input to spawn a sub-agent. */
export interface SpawnSubAgentInput {
  type: string;
  task: string;
  wait?: boolean;
  parentTurnId?: string | null;
  /** Parent mode for tool policy when resolving enabled tools. */
  modeId?: string;
}

/** Immediate spawn acknowledgement. */
export interface SpawnSubAgentResult {
  runId: string;
  status: SubAgentStatus;
}

/** Cancel tool / API result. */
export interface CancelSubAgentResult {
  ok: boolean;
  runId: string;
  status: SubAgentStatus;
}

/** Serialized parent tool result (static shape in tests). */
export interface AggregateResult {
  runId: string;
  type: string;
  status: SubAgentStatus;
  summary: string;
  startedAt: string | null;
  endedAt: string | null;
  toolTurns: number;
  cancelled: boolean;
  error?: string;
}

/** Context passed from the parent tool loop into spawn/cancel executors. */
export interface SubAgentExecutorContext {
  parentTurnId: string;
  modeId: string;
}

/** Runner output after an isolated sub-agent completes. */
export interface SubAgentRunnerOutput {
  summary: string;
  toolTurns: number;
  messages: ApiMessage[];
}

/** Injectable runner for tests (deterministic mock). */
export interface SubAgentRunner {
  run(input: {
    runId: string;
    type: string;
    task: string;
    systemPrompt: string;
    tools: OpenAIFunctionDefinition[];
    providerId: string;
    modelId: string;
    signal: AbortSignal;
    executeTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<import('../types').ToolExecutionResult>;
  }): Promise<SubAgentRunnerOutput>;
}
