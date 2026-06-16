/**
 * Sub-agent orchestrator — compatibility re-export shim (MIN-140 Phase 0).
 * Implementation lives in src/agents/controller/*; orchestrator.ts is the prompt's "controller".
 */

export {
  assertSubAgentRunReadableByParent,
  buildAggregateResult,
  buildSubAgentStatusPayload,
  cancelAllForParentTurn,
  cancelSubAgent,
  deriveSubAgentTerminalReason,
  formatAggregateResult,
  formatSubAgentListToolResult,
  formatSubAgentListToolResultForChat,
  getRunToolCallFingerprint,
  getSubAgentRun,
  listActiveSubAgentRuns,
  listSubAgentRunsForParentChat,
  listSubAgentRunsForParentTurn,
  recordToolCallForRun,
  resetSubAgentOrchestrator,
  restartSubAgent,
  spawnSubAgent,
  waitForSubAgent,
} from './controller/controller';
