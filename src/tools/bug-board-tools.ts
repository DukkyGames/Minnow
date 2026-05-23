/**
 * Bug tracker tools: bug_add, bug_update, bug_get_state (global #/bugs screen only).
 */

import {
  addBug,
  getBugBoardSnapshot,
  isBugColumn,
  isBugSeverity,
  updateBug,
} from '../state/bug-board-store.ts';
import { findChatById } from '../state/sessions.ts';
import { isGlobalBugsPageOpen } from '../ui/global-bugs-page.ts';
import type { BugCard, Chat } from '../types.ts';

export interface BugBoardExecutorContext {
  chatId: string;
}

let executorContext: BugBoardExecutorContext | null = null;

/** Set parent chat context for bug_* tools (from tool loop). */
export function setBugBoardExecutorContext(ctx: BugBoardExecutorContext | null): void {
  executorContext = ctx;
}

function resolveBugToolChat(): Chat | null {
  if (!isGlobalBugsPageOpen()) return null;
  const chatId = executorContext?.chatId?.trim();
  if (!chatId) return null;
  return findChatById(chatId);
}

function newBugId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `bug-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `bug-${Date.now().toString(36)}`;
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
  | { ok: true; bugId: string; patch: Parameters<typeof updateBug>[2] }
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

  const patch: Parameters<typeof updateBug>[2] = {};
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
  const chat = resolveBugToolChat();
  if (!chat) {
    return 'Error: bug board tools are only available on the All bugs screen (#/bugs)';
  }

  if (name === 'bug_add') {
    const validated = validateBugAddArgs(args);
    if (validated.ok === false) return validated.error;
    const bugId =
      typeof args.bug_id === 'string' && args.bug_id.trim()
        ? args.bug_id.trim()
        : newBugId();
    const card = addBug(chat, validated, bugId);
    return JSON.stringify(card, null, 2);
  }

  if (name === 'bug_update') {
    const validated = validateBugUpdateArgs(args);
    if (validated.ok === false) return validated.error;
    const updated = updateBug(chat, validated.bugId, validated.patch);
    if (!updated) return `Error: unknown bug_id "${validated.bugId}"`;
    return JSON.stringify(updated, null, 2);
  }

  if (name === 'bug_get_state') {
    const snapshot = getBugBoardSnapshot(chat);
    if (!snapshot) {
      return JSON.stringify({ bugs: [], startedAt: null, lastUpdatedAt: null }, null, 2);
    }
    return JSON.stringify(snapshot, null, 2);
  }

  return `Error: unknown bug board tool "${name}"`;
}
