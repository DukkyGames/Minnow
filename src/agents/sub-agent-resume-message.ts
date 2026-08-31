/**
 * Parent resume copy when sub-agents complete or need a long-running check-in.
 *
 * This is general (non-board) parent delivery. It used to live under
 * `src/chat/orchestrate/` next to V1 board lifecycle glue; MIN-714 deleted that
 * path, so the helper moved here beside the completion-push that calls it.
 */

import {
  buildAggregateResult,
  formatAggregateResult,
} from './orchestrator';
import type { SubAgentRun } from './types';

export type SubAgentParentDeliveryKind = 'completion' | 'check_in_nudge';

/** Build a user-role message that resumes the parent after sub-agent events. */
export function buildSubAgentParentResumeMessage(
  kind: SubAgentParentDeliveryKind,
  runs: SubAgentRun[],
  nudge?: { run: SubAgentRun; elapsedSec: number },
): string {
  if (kind === 'check_in_nudge' && nudge) {
    const { run, elapsedSec } = nudge;
    return (
      `[Sub-agent check-in] Sub-agent \`${run.type}\` (\`${run.runId}\`) has run ${elapsedSec}s ` +
      `and has not finished yet. It will report back automatically when done. ` +
      `Call \`get_sub_agent_status\` with run_id \`${run.runId}\` if you want a mid-run check. ` +
      `Do not poll in a loop — wait for the automatic completion message.`
    );
  }

  const terminal = runs.filter(
    (r) =>
      r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled',
  );
  if (terminal.length === 0) {
    return '[Sub-agent] No terminal runs to report.';
  }

  const blocks = terminal.map((run) => {
    const agg = buildAggregateResult(run);
    return formatAggregateResult(agg);
  });

  const header =
    terminal.length === 1
      ? '[Sub-agent finished] One sub-agent run completed. Use the summary below; `get_sub_agent_status` is available for details.'
      : `[Sub-agent finished] ${terminal.length} sub-agent runs completed. Summaries below.`;

  return `${header}\n\n${blocks.join('\n\n---\n\n')}`;
}
