/**
 * Bug tracker tools: bug_add, bug_update, bug_get_state (All bugs screen).
 */

import {
  addBug,
  getBugsSnapshot,
  isBugColumn,
  isBugSeverity,
  updateBug,
} from '../state/bug-board-store.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import { randomUUID } from '../lib/random-id.ts';
import { isGlobalBugsPageOpen } from '../ui/global-bugs-page.ts';
import type { BugCard } from '../types.ts';

/** Test override for global bugs page visibility (no DOM in node tests). */
let globalBugsPageOpenOverride: boolean | null = null;

/** Force All bugs screen open/closed in unit tests. */
export function setGlobalBugsPageOpenForTests(value: boolean | null): void {
  globalBugsPageOpenOverride = value;
}

function isBugToolScreenActive(): boolean {
  if (globalBugsPageOpenOverride !== null) return globalBugsPageOpenOverride;
  return isGlobalBugsPageOpen();
}

export interface BugBoardExecutorContext {
  chatId: string;
}

let executorContext: BugBoardExecutorContext | null = null;

/** Set parent chat context for bug_* tools (from tool loop; used for linked chat only). */
export function setBugBoardExecutorContext(ctx: BugBoardExecutorContext | null): void {
  executorContext = ctx;
}

function newBugId(): string {
  return `bug-${randomUUID().slice(0, 8)}`;
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
  | { ok: true; bugId: string; patch: Parameters<typeof updateBug>[1] }
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

  const patch: Parameters<typeof updateBug>[1] = {};
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
  if (
    !patch.column &&
    patch.notes === undefined &&
    patch.planPath === undefined &&
    typeof args.investigate_run_id !== 'string' &&
    typeof args.plan_run_id !== 'string'
  ) {
    return { ok: false, error: 'Error: bug_update requires at least one field to change' };
  }
  if (typeof args.investigate_run_id === 'string' && args.investigate_run_id.trim()) {
    patch.investigateRunId = args.investigate_run_id.trim();
  }
  if (typeof args.plan_run_id === 'string' && args.plan_run_id.trim()) {
    patch.planRunId = args.plan_run_id.trim();
  }

  return { ok: true, bugId, patch };
}

/** Execute bug_add / bug_update / bug_get_state. */
export async function executeBugBoardTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!isBugToolScreenActive()) {
    return 'Error: bug board tools require the All bugs screen (#/bugs)';
  }

  if (name === 'bug_add') {
    const validated = validateBugAddArgs(args);
    if (validated.ok === false) return validated.error;
    const bugId =
      typeof args.bug_id === 'string' && args.bug_id.trim()
        ? args.bug_id.trim()
        : newBugId();
    const card = addBug(
      {
        ...validated,
        workspacePath: getWorkspacePath(),
      },
      bugId,
    );
    return JSON.stringify(card, null, 2);
  }

  if (name === 'bug_update') {
    const validated = validateBugUpdateArgs(args);
    if (validated.ok === false) return validated.error;
    const updated = updateBug(validated.bugId, validated.patch);
    if (!updated) return `Error: unknown bug_id "${validated.bugId}"`;
    return JSON.stringify(updated, null, 2);
  }

  if (name === 'bug_get_state') {
    return JSON.stringify(getBugsSnapshot(), null, 2);
  }

  return `Error: unknown bug board tool "${name}"`;
}
