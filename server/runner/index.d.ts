import type { RunnerDeps } from './adapters';
import type { SubAgentRunner } from '../../src/agents/types';
import type { ApiMessage } from '../../src/types';

export { createMemoryTranscriptStore } from './transcript-store';
export type { TranscriptStore, TranscriptRecord, TranscriptMeta, TranscriptMessage } from './transcript-store';
export { postChatCompletionsHttp, runHeadlessToolBatchStub } from './adapters';
export type { RunnerDeps, PostChatCompletions, RunHeadlessToolBatch, RunnerProvider } from './adapters';
export {
  createCompletionStream,
  postChatCompletionsInProcess,
  RUNNER_FALLBACK_ROLE,
} from './generation-binding';
export type { CompletionStream, CompletionStreamOptions } from './generation-binding';
export { runTurn, DEFAULT_REPORT_TOOL_NAME } from './run-turn';
export type {
  TurnResult,
  AttemptResult,
  TurnEvent,
  TurnModel,
  TurnLimits,
  TurnToolDefinition,
  RunTurnOptions,
  ParseReport,
  ParseReportResult,
} from './run-turn';
export { createInProcessToolDispatch, executeInProcessTool } from './tool-dispatch';
export type {
  ExecuteInProcessToolOptions,
  InProcessToolResult,
  CreateInProcessToolDispatchOptions,
  InProcessToolDispatch,
} from './tool-dispatch';
export { executeToolCallBatch, STOPPED_TOOL_MSG } from './tool-batch';
export {
  MAX_PARALLEL_READ_TOOLS,
  isParallelSafeTool,
  partitionToolCalls,
} from './parallel-tool-policy';
export {
  DEFAULT_HEADLESS_TOOL_IDS,
  RENDERER_ONLY_TOOL_IDS,
  isRendererOnlyTool,
  rendererOnlyToolsIn,
} from './tool-set';

/** Build a runner that closes over injected I/O. There is one loop implementation. */
export function createSubAgentRunner(deps: RunnerDeps): SubAgentRunner;

export function cloneSubAgentMessages(messages: ApiMessage[]): ApiMessage[];
