/**
 * Browser-side executor for `report_orchestrator_status` (supervisor heartbeat).
 */

import type { ReportToolResult } from './report-types.ts';
import { parseOrchestratorStatusReport } from './report-types.ts';
import { getSupervisorChatState } from './state.ts';
import { bumpOrchestratorProgress } from './progress.ts';

function normalizeReportArgs(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    phase: raw.phase,
    nextAction: raw.nextAction ?? raw.next_action,
    activeTasks: raw.activeTasks ?? raw.active_tasks,
    blockedTasks: raw.blockedTasks ?? raw.blocked_tasks,
    currentWaveId: raw.currentWaveId ?? raw.current_wave_id,
    note: raw.note,
    confidence: raw.confidence,
  };
}

/**
 * Validates args, stamps supervisor state, and returns JSON guidance for the model.
 */
export async function executeReportOrchestratorStatus(
  args: Record<string, unknown>,
  chatId: string | undefined,
): Promise<string> {
  const parsed = parseOrchestratorStatusReport(normalizeReportArgs(args));
  if (parsed.ok === false) {
    return JSON.stringify({ status: 'error', message: parsed.error });
  }
  if (!chatId?.trim()) {
    return JSON.stringify({ status: 'error', message: 'missing chat context' });
  }

  const now = Date.now();
  const sup = getSupervisorChatState(chatId.trim());
  sup.lastReportAt = now;
  sup.lastReport = parsed.report;
  bumpOrchestratorProgress(chatId.trim(), now);

  const out: ReportToolResult = {
    status: 'ok',
    recordedAt: now,
  };

  if (typeof parsed.report.confidence === 'number' && parsed.report.confidence < 0.5) {
    out.status = 'warning';
    out.guidance = 'Confidence is low; double-check assumptions before continuing.';
  }

  if (parsed.report.blockedTasks.length > 0) {
    out.status = out.status === 'ok' ? 'warning' : out.status;
    out.guidance = `${out.guidance ?? ''} Blocked tasks need a plan update or user input.`.trim();
  }

  return JSON.stringify(out as ReportToolResult);
}
