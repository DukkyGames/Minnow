import {
  addIssue,
  bugColumnToIssueStatus,
  bugSeverityToIssuePriority,
  getIssuesSnapshot,
  isBugColumn,
  isBugSeverity,
  issueToBugCard,
  updateIssue,
} from '../state/issues-store.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import type { BugCard } from '../types.ts';

/** @deprecated No longer screen-gated; kept for test API compatibility. */
let globalBugsPageOpenOverride: boolean | null = null;

/** @deprecated Force All bugs screen open/closed in unit tests (ignored). */
export function setGlobalBugsPageOpenForTests(value: boolean | null): void {
  globalBugsPageOpenOverride = value;
}

export interface BugBoardExecutorContext {
  chatId: string;
}

let executorContext: BugBoardExecutorContext | null = null;

/** Set parent chat context for bug_* tools (linked chat only). */
export function setBugBoardExecutorContext(ctx: BugBoardExecutorContext | null): void {
  executorContext = ctx;
}

export type ValidateBugAddResult =
  | { ok: true; title: string; description: string; severity: BugCard['severity'] }
  | { ok: false; error: string };

/** Validate bug_add arguments (exported for tests). */
export function validateBugAddArgs(args: Record<string, unknown>): ValidateBugAddResult {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  const severityRaw = typeof args.severity === 'string' ? args.severity.trim() : 'medium';
  if (!title) return { ok: false, error: 'Error: bug_add requires "title"' };
  if (!isBugSeverity(severityRaw)) {
    return { ok: false, error: 'Error: severity must be low, medium, high, or critical' };
  }
  return { ok: true, title, description, severity: severityRaw };
}

export type ValidateBugUpdateResult =
  | {
      ok: true;
      bugId: string;
      patch: {
        column?: BugCard['column'];
        notes?: string;
        planPath?: string;
        investigateRunId?: string;
        planRunId?: string;
      };
    }
  | { ok: false; error: string };

/** Validate bug_update arguments (exported for tests). */
export function validateBugUpdateArgs(args: Record<string, unknown>): ValidateBugUpdateResult {
  const bugId =
    typeof args.bug_id === 'string'
      ? args.bug_id.trim()
      : typeof args.bugId === 'string'
        ? args.bugId.trim()
        : '';
  if (!bugId) return { ok: false, error: 'Error: bug_update requires "bug_id"' };

  const patch: {
    column?: BugCard['column'];
    notes?: string;
    planPath?: string;
    investigateRunId?: string;
    planRunId?: string;
  } = {};
  const columnRaw = typeof args.column === 'string' ? args.column.trim() : '';
  if (columnRaw) {
    if (!isBugColumn(columnRaw)) {
      return {
        ok: false,
        error:
          'Error: column must be reported, investigating, planned, fixing, or complete',
      };
    }
    patch.column = columnRaw;
  }
  if (typeof args.notes === 'string') patch.notes = args.notes;
  if (typeof args.plan_path === 'string' && args.plan_path.trim()) {
    patch.planPath = args.plan_path.trim();
  }
  if (typeof args.investigate_run_id === 'string' && args.investigate_run_id.trim()) {
    patch.investigateRunId = args.investigate_run_id.trim();
  }
  if (typeof args.plan_run_id === 'string' && args.plan_run_id.trim()) {
    patch.planRunId = args.plan_run_id.trim();
  }

  if (
    !patch.column &&
    patch.notes === undefined &&
    patch.planPath === undefined &&
    patch.investigateRunId === undefined &&
    patch.planRunId === undefined
  ) {
    return { ok: false, error: 'Error: bug_update requires at least one field to change' };
  }

  return { ok: true, bugId, patch };
}

/** Execute bug_add / bug_update / bug_get_state via the Issues store (no screen gate). */
export async function executeBugBoardTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  void globalBugsPageOpenOverride;
  void executorContext;

  if (name === 'bug_add') {
    const validated = validateBugAddArgs(args);
    if (validated.ok === false) return validated.error;
    const legacyBugId =
      typeof args.bug_id === 'string' && args.bug_id.trim()
        ? args.bug_id.trim()
        : undefined;
    const card = addIssue({
      title: validated.title,
      description: validated.description,
      type: 'bug',
      status: 'triage',
      priority: bugSeverityToIssuePriority(validated.severity),
      severity: validated.severity,
      legacyBugId,
      workspacePath: getWorkspacePath(),
    });
    return JSON.stringify(issueToBugCard(card), null, 2);
  }

  if (name === 'bug_update') {
    const validated = validateBugUpdateArgs(args);
    if (validated.ok === false) return validated.error;
    const updated = updateIssue(validated.bugId, {
      status: validated.patch.column
        ? bugColumnToIssueStatus(validated.patch.column)
        : undefined,
      notes: validated.patch.notes,
      planPath: validated.patch.planPath,
      investigateRunId: validated.patch.investigateRunId,
      planRunId: validated.patch.planRunId,
    });
    if (!updated) return `Error: unknown bug_id "${validated.bugId}"`;
    return JSON.stringify(issueToBugCard(updated), null, 2);
  }

  if (name === 'bug_get_state') {
    const snap = getIssuesSnapshot();
    return JSON.stringify(
      { version: 1, bugs: snap.issues.map((issue) => issueToBugCard(issue)) },
      null,
      2,
    );
  }

  return `Error: unknown bug board tool "${name}"`;
}
