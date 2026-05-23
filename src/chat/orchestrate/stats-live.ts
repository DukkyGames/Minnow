/**
 * Live refresh of Orchestrate aggregated stats when sub-agents settle (MIN-36).
 */

import { subscribeSubAgentRuns } from '../../agents/sub-agent-events';
import { refreshOrchestrateStatsAfterSubAgent } from './stats-aggregate';

/** Subscribe once at app boot to update lastStats when background sub-agents finish. */
export function initOrchestrateStatsLiveRefresh(): void {
  subscribeSubAgentRuns((run) => {
    refreshOrchestrateStatsAfterSubAgent(run);
  });
}
