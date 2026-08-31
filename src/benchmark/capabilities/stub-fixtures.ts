/**
 * Stub payloads for emit-only capability probes.
 *
 * A bare `{ok:true, stubbed:"browser_snapshot"}` gives the model nothing to act on, so
 * every chain probe stalled after its first round. These stubs return the shape the real
 * tool would, with stable ids the verdicts check the model actually reused.
 */

import type { IssueIssueRef } from '../../types.ts';

/**
 * Element uids the browser snapshot stub hands back (browser-snapshot probe).
 *
 * Numbers, not `ref_N` strings: the real snapshot stamps numeric `data-mn-uid`s and
 * `browser_click` / `browser_fill` take `uid: number`. A stub speaking a shape the
 * schema rejects forced the model to invent a translation and scored it down for it.
 */
export const CAP_STUB_SNAPSHOT_UIDS = [7, 8] as const;

/** Sub-agent id returned as still running (agents-sub-agent-control probe). */
export const CAP_STUB_SUB_AGENT_ID = 'sub-agent-cap-42';

/** Board task id the worker is told it finished (agents-board-report probe). */
export const CAP_STUB_BOARD_TASK_ID = 'task-1';

/** Thread id returned by the mail listing stub (apps-email-list probe). */
export const CAP_STUB_THREAD_ID = 'thread-cap-9001';

const STUB_BY_TOOL: Record<string, unknown> = {
  // Two tabs, the newly opened one active: a listing that still showed only
  // `about:blank` after the model had just opened a tab read as a broken environment,
  // and models burned their answer explaining the contradiction.
  browser_list: {
    tabs: [
      { tabId: 'tab_1', url: 'about:blank', active: false },
      { tabId: 'tab_2', url: 'https://example.com/', active: true },
    ],
  },
  browser_snapshot: {
    url: 'https://example.com/',
    // `text` mirrors what the real tool renders (`[uid] role "name"`), so the uid the
    // model must pass back to browser_fill / browser_click is unmistakable.
    text: `[${CAP_STUB_SNAPSHOT_UIDS[0]}] textbox "Search"\n[${CAP_STUB_SNAPSHOT_UIDS[1]}] button "Submit"`,
    nodes: [
      { uid: CAP_STUB_SNAPSHOT_UIDS[0], role: 'textbox', name: 'Search' },
      { uid: CAP_STUB_SNAPSHOT_UIDS[1], role: 'button', name: 'Submit' },
    ],
  },
  browser_eval: { result: 'rgb(255, 255, 255)' },
  browser_screenshot: { captured: true, width: 1280, height: 800 },

  list_sub_agents: {
    agents: [
      { id: CAP_STUB_SUB_AGENT_ID, status: 'running', task: 'audit the tool catalog' },
      { id: 'sub-agent-cap-41', status: 'completed', task: 'draft the summary' },
    ],
  },
  get_sub_agent_status: { id: CAP_STUB_SUB_AGENT_ID, status: 'running', progress: 0.4 },

  recall_chat_context: {
    turns: [
      { index: 3, role: 'user', text: 'Deployment checklist: 1) tag, 2) build, 3) smoke test staging.' },
    ],
  },
  recall_turn_full: {
    index: 3,
    role: 'user',
    text: 'Deployment checklist: 1) tag, 2) build, 3) smoke test staging.',
  },

  list_mail: {
    messages: [
      {
        threadId: CAP_STUB_THREAD_ID,
        from: 'sam@example.com',
        subject: 'Contract review',
        unread: true,
      },
      {
        threadId: 'thread-cap-9002',
        from: 'devops@example.com',
        subject: 'Nightly build failed',
        unread: true,
      },
    ],
  },
  get_thread: {
    threadId: CAP_STUB_THREAD_ID,
    messages: [{ from: 'sam@example.com', body: 'Can you look at the contract this week?' }],
  },
  summarize_inbox: {
    summary: 'Two unread: a contract review from Sam and a failed nightly build.',
  },

  get_system_info: { platform: 'linux', arch: 'x64', cpus: 16, totalMemoryGb: 64 },
  read_clipboard: { text: '' },
};

function normalizeStubIssueRefs(raw: unknown): IssueIssueRef[] {
  if (!Array.isArray(raw)) return [];
  const out: IssueIssueRef[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ issueId: item.trim(), kind: 'related', addedAt: 1 });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const issueId =
      typeof obj.issue_id === 'string'
        ? obj.issue_id.trim()
        : typeof obj.issueId === 'string'
          ? obj.issueId.trim()
          : '';
    if (!issueId) continue;
    const kindRaw = typeof obj.kind === 'string' ? obj.kind.trim() : 'related';
    const kind =
      kindRaw === 'related' ||
      kindRaw === 'blocks' ||
      kindRaw === 'blocked-by' ||
      kindRaw === 'duplicate-of' ||
      kindRaw === 'parent' ||
      kindRaw === 'sub-issue'
        ? kindRaw
        : 'related';
    out.push({
      issueId,
      kind,
      addedAt: 1,
      ...(typeof obj.note === 'string' && obj.note.trim() ? { note: obj.note.trim() } : {}),
    });
  }
  return out;
}

/** Realistic stub body for an emit-only tool, or null to use the generic stub. */
export function capabilityStubPayload(
  toolName: string,
  args?: Record<string, unknown>,
): unknown | null {
  if (toolName === 'issue_add') {
    const title = typeof args?.title === 'string' ? args.title.trim() : 'New issue';
    return {
      id: 'ISS-2',
      title: title || 'New issue',
      status: 'triage',
      type: 'task',
      priority: 'none',
      labels: [],
    };
  }
  if (toolName === 'issue_get_state') {
    return {
      issues: [{ id: 'ISS-1', title: 'Prior grid bug', status: 'triage' }],
      nextIssuePreview: 'ISS-2',
    };
  }
  if (toolName === 'issue_link') {
    const issueId =
      typeof args?.issue_id === 'string' && args.issue_id.trim()
        ? args.issue_id.trim()
        : typeof args?.issueId === 'string' && args.issueId.trim()
          ? args.issueId.trim()
          : 'ISS-2';
    return {
      id: issueId,
      issueRefs: normalizeStubIssueRefs(args?.issue_refs ?? args?.issueRefs),
    };
  }
  if (toolName === 'issue_search') {
    return {
      total: 1,
      limit: 25,
      offset: 0,
      issues: [{ id: 'ISS-1', title: 'Prior grid bug', status: 'triage' }],
    };
  }
  if (toolName === 'issue_comment') {
    return { id: args?.issue_id ?? 'ISS-1', commentCount: 1 };
  }
  if (toolName === 'issue_assign') {
    return { id: args?.issue_id ?? 'ISS-1', assignee: args?.assignee ?? 'me' };
  }
  if (toolName === 'issue_unlink') {
    return { id: args?.issue_id ?? 'ISS-1', removed: true };
  }
  if (toolName === 'issue_move') {
    return { id: args?.issue_id ?? 'ISS-1', status: args?.status ?? 'todo' };
  }
  return STUB_BY_TOOL[toolName] ?? null;
}
