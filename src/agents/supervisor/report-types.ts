/**
 * Structured status from the orchestrate parent model (supervisor heartbeat).
 */

export interface OrchestratorStatusReport {
  phase: string;
  nextAction: string;
  activeTasks: string[];
  blockedTasks: string[];
  currentWaveId?: string;
  note?: string;
  /** Model self-confidence 0–1; drives R10 when low. */
  confidence?: number;
}

export type ReportToolStatus = 'ok' | 'warning' | 'instruct';

/** JSON-shaped tool result returned to the model after `report_orchestrator_status`. */
export interface ReportToolResult {
  status: ReportToolStatus;
  guidance?: string;
  instructions?: {
    skipTask?: string;
    restartRunId?: string;
    pauseUntilUserResponds?: boolean;
  };
  recordedAt: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate loosely-typed tool args into a report row (strict required fields).
 */
export function parseOrchestratorStatusReport(
  raw: Record<string, unknown>,
): { ok: true; report: OrchestratorStatusReport } | { ok: false; error: string } {
  if (!isNonEmptyString(raw.phase)) {
    return { ok: false, error: 'missing non-empty "phase"' };
  }
  if (!isNonEmptyString(raw.nextAction)) {
    return { ok: false, error: 'missing non-empty "nextAction"' };
  }
  if (!isStringArray(raw.activeTasks)) {
    return { ok: false, error: '"activeTasks" must be an array of strings' };
  }
  if (!isStringArray(raw.blockedTasks)) {
    return { ok: false, error: '"blockedTasks" must be an array of strings' };
  }

  const report: OrchestratorStatusReport = {
    phase: raw.phase.trim(),
    nextAction: raw.nextAction.trim(),
    activeTasks: raw.activeTasks.map((s) => s.trim()),
    blockedTasks: raw.blockedTasks.map((s) => s.trim()),
  };

  if (raw.currentWaveId != null && isNonEmptyString(raw.currentWaveId)) {
    report.currentWaveId = raw.currentWaveId.trim();
  }
  if (raw.note != null && typeof raw.note === 'string') {
    report.note = raw.note;
  }
  if (typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)) {
    report.confidence = Math.min(1, Math.max(0, raw.confidence));
  }

  return { ok: true, report };
}
