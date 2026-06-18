/**
 * Self-healing controller — re-exports watchdog (moved to controller/ in MIN-140 Phase 0).
 */

export {
  observeSubAgentToolCall,
  resetSelfHealingState,
  resetWatchdogState,
} from '../controller/watchdog';
