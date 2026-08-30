/**
 * Shared headless turn loop (MIN-698 / Orchestrator V2 P2-A).
 *
 * Importable from the Node server (`node server.js`, no transpile) and from the
 * Vite renderer. The loop does not know what a board is. I/O (transcript,
 * completions, tools) is injected.
 *
 * P2-B adds `runTurn()`. P2-C/P2-D swap the completion and tool adapters.
 *
 * Node-only adapters (`generation-binding`, `tool-dispatch`) live on `node.js`.
 * Vite follows every static re-export in this file, so naming them here would
 * pull `tools-middleware` / `officeparser` into the client dep optimizer.
 * The Vite renderer imports `createSubAgentRunner` from this barrel.
 * Renderer tool batching stays in `src/tools/headless-tool-batch.ts`.
 *
 * Any change to the `runTurn()` signature is a Phase 6 finding.
 */

export { createSubAgentRunner, cloneSubAgentMessages } from './sub-agent-runner.js';
export { createMemoryTranscriptStore } from './transcript-store.js';
export { postChatCompletionsHttp, runHeadlessToolBatchStub } from './adapters.js';
export { runTurn, DEFAULT_REPORT_TOOL_NAME } from './run-turn.js';
export { executeToolCallBatch, STOPPED_TOOL_MSG } from './tool-batch.js';
export {
  MAX_PARALLEL_READ_TOOLS,
  isParallelSafeTool,
  partitionToolCalls,
} from './parallel-tool-policy.js';
export {
  DEFAULT_HEADLESS_TOOL_IDS,
  RENDERER_ONLY_TOOL_IDS,
  isRendererOnlyTool,
  rendererOnlyToolsIn,
} from './tool-set.js';
