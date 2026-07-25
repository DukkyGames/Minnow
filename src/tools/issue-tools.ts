/**
 * Issues tools: issue_add, issue_update, issue_link, issue_get_state (MIN-261).
 * Not screen-gated — any chat/agent may file or update issues.
 */

import {
  addIssue,
  appendIssueLinks,
  collectIssues,
  getIssuesSnapshot,
  isIssuePriority,
  isIssueStatus,
  isIssueType,
  normalizeIssueCodeRef,
  normalizeIssueGitLink,
  updateIssue,
} from '../state/issues-store.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import type { IssueCodeRef, IssueGitLink, IssuePriority, IssueStatus, IssueType } from '../types.ts';

export type ValidateIssueAddResult =
  | {
      ok: true;
      title: string;
      description: string;
      type: IssueType;
      priority: IssuePriority;
      labels: string[];
    }
  | { ok: false; error: string };

/** Validate issue_add arguments (exported for tests). */
export function validateIssueAddArgs(args: Record<string, unknown>): ValidateIssueAddResult {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) return { ok: false, error: 'Error: issue_add requires "title"' };
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  const typeRaw = typeof args.type === 'string' ? args.type.trim() : 'task';
  if (!isIssueType(typeRaw)) {
    return { ok: false, error: 'Error: type must be bug, task, idea, or note' };
  }
  const priorityRaw = typeof args.priority === 'string' ? args.priority.trim() : 'none';
  if (!isIssuePriority(priorityRaw)) {
    return {
      ok: false,
      error: 'Error: priority must be urgent, high, medium, low, or none',
    };
  }
  const labels = Array.isArray(args.labels)
    ? args.labels
        .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
        .map((l) => l.trim())
    : [];
  return { ok: true, title, description, type: typeRaw, priority: priorityRaw, labels };
}

export type ValidateIssueUpdateResult =
  | { ok: true; issueId: string; patch: Parameters<typeof updateIssue>[1] }
  | { ok: false; error: string };

/** Validate issue_update arguments (exported for tests). */
export function validateIssueUpdateArgs(args: Record<string, unknown>): ValidateIssueUpdateResult {
  const issueId =
    typeof args.issue_id === 'string'
      ? args.issue_id.trim()
      : typeof args.issueId === 'string'
        ? args.issueId.trim()
        : '';
  if (!issueId) return { ok: false, error: 'Error: issue_update requires "issue_id"' };

  const patch: Parameters<typeof updateIssue>[1] = {};
  if (typeof args.title === 'string') patch.title = args.title;
  if (typeof args.description === 'string') patch.description = args.description;
  if (typeof args.notes === 'string') patch.notes = args.notes;
  if (typeof args.plan_path === 'string' && args.plan_path.trim()) {
    patch.planPath = args.plan_path.trim();
  }
  if (typeof args.type === 'string' && args.type.trim()) {
    if (!isIssueType(args.type.trim())) {
      return { ok: false, error: 'Error: type must be bug, task, idea, or note' };
    }
    patch.type = args.type.trim() as IssueType;
  }
  if (typeof args.status === 'string' && args.status.trim()) {
    if (!isIssueStatus(args.status.trim())) {
      return {
        ok: false,
        error:
          'Error: status must be triage, backlog, todo, planned, in_progress, review, done, or canceled',
      };
    }
    patch.status = args.status.trim() as IssueStatus;
  }
  if (typeof args.priority === 'string' && args.priority.trim()) {
    if (!isIssuePriority(args.priority.trim())) {
      return {
        ok: false,
        error: 'Error: priority must be urgent, high, medium, low, or none',
      };
    }
    patch.priority = args.priority.trim() as IssuePriority;
  }
  if (Array.isArray(args.labels)) {
    patch.labels = args.labels
      .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      .map((l) => l.trim());
  }

  if (
    patch.title === undefined &&
    patch.description === undefined &&
    patch.notes === undefined &&
    patch.planPath === undefined &&
    patch.type === undefined &&
    patch.status === undefined &&
    patch.priority === undefined &&
    patch.labels === undefined
  ) {
    return { ok: false, error: 'Error: issue_update requires at least one field to change' };
  }

  return { ok: true, issueId, patch };
}

export type ValidateIssueLinkResult =
  | {
      ok: true;
      issueId: string;
      codeRefs: IssueCodeRef[];
      gitLinks: Array<Omit<IssueGitLink, 'addedAt'> & { addedAt?: number }>;
      chatId?: string;
    }
  | { ok: false; error: string };

function parseCodeRefArg(raw: unknown): IssueCodeRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const path =
    typeof obj.path === 'string'
      ? obj.path
      : typeof obj.workspacePath === 'string'
        ? obj.workspacePath
        : '';
  if (!path.trim()) return null;
  const startLine =
    typeof obj.start_line === 'number'
      ? obj.start_line
      : typeof obj.startLine === 'number'
        ? obj.startLine
        : undefined;
  const endLine =
    typeof obj.end_line === 'number'
      ? obj.end_line
      : typeof obj.endLine === 'number'
        ? obj.endLine
        : undefined;
  const snippet = typeof obj.snippet === 'string' ? obj.snippet : undefined;
  const note = typeof obj.note === 'string' ? obj.note : undefined;
  return normalizeIssueCodeRef({ path, startLine, endLine, snippet, note });
}

function parseGitLinkArg(
  raw: unknown,
): (Omit<IssueGitLink, 'addedAt'> & { addedAt?: number }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === 'string' ? obj.kind : '';
  const ref = typeof obj.ref === 'string' ? obj.ref : '';
  const normalized = normalizeIssueGitLink({
    kind: kind as IssueGitLink['kind'],
    ref,
    url: typeof obj.url === 'string' ? obj.url : undefined,
    title: typeof obj.title === 'string' ? obj.title : undefined,
  });
  return normalized;
}

/** Validate issue_link arguments (append-only; exported for tests). */
export function validateIssueLinkArgs(args: Record<string, unknown>): ValidateIssueLinkResult {
  const issueId =
    typeof args.issue_id === 'string'
      ? args.issue_id.trim()
      : typeof args.issueId === 'string'
        ? args.issueId.trim()
        : '';
  if (!issueId) return { ok: false, error: 'Error: issue_link requires "issue_id"' };

  const codeRefs: IssueCodeRef[] = [];
  const codeRaw = args.code_refs ?? args.codeRefs;
  if (codeRaw !== undefined) {
    if (!Array.isArray(codeRaw)) {
      return { ok: false, error: 'Error: code_refs must be an array' };
    }
    for (const item of codeRaw) {
      const ref = parseCodeRefArg(item);
      if (!ref) {
        return {
          ok: false,
          error: 'Error: each code_ref needs path (and optional start_line/end_line)',
        };
      }
      codeRefs.push(ref);
    }
  }

  const gitLinks: Array<Omit<IssueGitLink, 'addedAt'> & { addedAt?: number }> = [];
  const gitRaw = args.git_links ?? args.gitLinks;
  if (gitRaw !== undefined) {
    if (!Array.isArray(gitRaw)) {
      return { ok: false, error: 'Error: git_links must be an array' };
    }
    for (const item of gitRaw) {
      const link = parseGitLinkArg(item);
      if (!link) {
        return {
          ok: false,
          error:
            'Error: each git_link needs kind (commit|branch|pr|github-issue) and ref',
        };
      }
      gitLinks.push(link);
    }
  }

  const chatId =
    typeof args.chat_id === 'string'
      ? args.chat_id.trim()
      : typeof args.chatId === 'string'
        ? args.chatId.trim()
        : '';

  if (codeRefs.length === 0 && gitLinks.length === 0 && !chatId) {
    return {
      ok: false,
      error: 'Error: issue_link requires code_refs, git_links, and/or chat_id',
    };
  }

  return {
    ok: true,
    issueId,
    codeRefs,
    gitLinks,
    chatId: chatId || undefined,
  };
}

/** Execute issue_add / issue_update / issue_link / issue_get_state. */
export async function executeIssueTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'issue_add') {
    const validated = validateIssueAddArgs(args);
    if (validated.ok === false) return validated.error;
    const issueId =
      typeof args.issue_id === 'string' && args.issue_id.trim()
        ? args.issue_id.trim()
        : undefined;
    const card = addIssue(
      {
        title: validated.title,
        description: validated.description,
        type: validated.type,
        priority: validated.priority,
        labels: validated.labels,
        workspacePath: getWorkspacePath(),
      },
      issueId,
    );
    return JSON.stringify(card, null, 2);
  }

  if (name === 'issue_update') {
    const validated = validateIssueUpdateArgs(args);
    if (validated.ok === false) return validated.error;
    const updated = updateIssue(validated.issueId, validated.patch);
    if (!updated) return `Error: unknown issue_id "${validated.issueId}"`;
    return JSON.stringify(updated, null, 2);
  }

  if (name === 'issue_link') {
    const validated = validateIssueLinkArgs(args);
    if (validated.ok === false) return validated.error;
    const updated = appendIssueLinks(validated.issueId, {
      codeRefs: validated.codeRefs,
      gitLinks: validated.gitLinks,
      chatId: validated.chatId,
    });
    if (!updated) return `Error: unknown issue_id "${validated.issueId}"`;
    return JSON.stringify(updated, null, 2);
  }

  if (name === 'issue_get_state') {
    const scope =
      args.workspace_scope === 'all' || args.scope === 'all' ? 'all' : 'current_workspace';
    const statusRaw = typeof args.status === 'string' ? args.status.trim() : 'all';
    const status =
      statusRaw === 'all' || !isIssueStatus(statusRaw) ? 'all' : (statusRaw as IssueStatus);
    const issues = collectIssues({
      scope,
      workspacePath: getWorkspacePath(),
      status,
      hideDone: false,
    });
    const snap = getIssuesSnapshot();
    return JSON.stringify(
      {
        version: snap.version,
        nextId: snap.nextId,
        scope,
        status,
        issues,
      },
      null,
      2,
    );
  }

  return `Error: unknown issue tool "${name}"`;
}
