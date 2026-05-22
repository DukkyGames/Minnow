/**
 * Orchestrate supervisor — unified stall, heartbeat, repetition, and escalation layer.
 */

export {
  startSupervisor,
  stopSupervisor,
  startOrchestrateWatchdog,
  stopOrchestrateWatchdog,
  setWatchdogLastTerminalForTests,
} from './loop.ts';
export {
  evaluateOrchestrateStall,
  ORCHESTRATE_WATCHDOG_STALL_MS,
  ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK,
  type OrchestrateWatchdogDeps,
  type StallEvaluation,
} from './detector.ts';
export { isChatStalledForUi as isOrchestrateWatchdogStalled } from './state.ts';
export { getOrchestrateWatchdogStallMs } from './runtime-stall.ts';
export { executeReportOrchestratorStatus } from './report-tool.ts';
export { recordParentToolResult, bumpOrchestratorProgress } from './progress.ts';
export {
  invalidateSupervisorConfigCache,
  loadSupervisorConfig,
  getSupervisorConfigSnapshot,
} from './config.ts';
export type { SupervisorConfig } from './defaults.ts';
