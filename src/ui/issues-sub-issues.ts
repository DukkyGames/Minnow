/**
 * Create, attach, and unparent sub-issues from peek, menus, and drops.
 *
 * Hierarchy is `parentId` only. Related `issueRefs` stay a separate graph.
 */

import {
  canReceiveSubIssues,
  eligibleSubIssueCandidates,
  partitionParentDrop,
} from '../issues/hierarchy';
import {
  addIssue,
  findIssueById,
  listIssues,
  updateIssue,
} from '../state/issues-store';
import type { IssueCard } from '../types';
import { openIssuesContextMenu, type IssuesContextMenuItem } from './issues-context-menu';

/** Keep the attach picker a menu, not a search dialog. */
const ATTACH_MENU_CAP = 30;

function toastError(message: string): void {
  void import('./toast').then((m) => m.showToast(message, 'error'));
}

/** Peek does not subscribe to the store; list refresh comes from issues-page. */
function refreshOpenPeek(): void {
  void import('./issues-detail').then((m) => m.refreshIssueDetailIfOpen());
}

/** Whether this card may gain children (one-level rule). */
export function canIssueReceiveSubIssues(parentId: string) {
  return canReceiveSubIssues(parentId, listIssues());
}

/** Same-workspace cards that can nest under `parentId`. */
export function workspaceEligibleSubIssues(parentId: string): IssueCard[] {
  const parent = findIssueById(parentId);
  if (!parent) return [];
  const parentWs = (parent.workspacePath ?? '').trim();
  return eligibleSubIssueCandidates(parentId, listIssues()).filter(
    (issue) => (issue.workspacePath ?? '').trim() === parentWs,
  );
}

/** Title prompt, then a child that inherits workspace and project. */
export async function promptCreateSubIssue(parentId: string): Promise<void> {
  const gate = canIssueReceiveSubIssues(parentId);
  if (!gate.ok) {
    toastError(gate.error);
    return;
  }
  const parent = findIssueById(parentId);
  if (!parent) return;
  const { appPrompt } = await import('./app-dialog');
  const title = await appPrompt('Sub-issue title', '');
  if (!title?.trim()) return;
  try {
    addIssue({
      title: title.trim(),
      parentId,
      workspacePath: parent.workspacePath,
      projectId: parent.projectId,
    });
  } catch (err) {
    toastError(err instanceof Error ? err.message : 'Could not create sub-issue');
    return;
  }
  refreshOpenPeek();
}

/** Clear `parentId` without deleting the card. */
export function unparentIssueFromParent(childId: string): void {
  const child = findIssueById(childId);
  if (!child?.parentId) return;
  updateIssue(childId, { parentId: null });
  refreshOpenPeek();
}

/**
 * Nest each accepted id under `parentId`.
 *
 * Invalid movers toast the first `validateParentLink` error and are skipped.
 */
export function applyIssueParentDrop(parentId: string, childIds: readonly string[]): void {
  const { accepted, rejected } = partitionParentDrop(parentId, childIds, listIssues());
  for (const id of accepted) {
    try {
      updateIssue(id, { parentId });
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not nest issue');
    }
  }
  if (rejected.length > 0) toastError(rejected[0].error);
  if (accepted.length > 0) refreshOpenPeek();
}

/** Context-menu picker of existing issues to attach. */
export function openAttachSubIssueMenu(parentId: string, anchor: HTMLElement): void {
  const candidates = workspaceEligibleSubIssues(parentId).slice(0, ATTACH_MENU_CAP);
  if (candidates.length === 0) return;
  openIssuesContextMenu({
    anchor,
    restoreFocus: anchor,
    label: 'Attach existing issue',
    items: candidates.map((issue) => ({
      id: `attach-${issue.id}`,
      label: issue.title.trim() || issue.id,
      hint: issue.id,
      onSelect: () => applyIssueParentDrop(parentId, [issue.id]),
    })),
  });
}

/** Menu behind the Sub-issues + control: create a child, or nest one that exists. */
export function subIssueAddMenuItems(parentId: string): IssuesContextMenuItem[] {
  const receive = canIssueReceiveSubIssues(parentId);
  const attachable = workspaceEligibleSubIssues(parentId);
  return [
    {
      id: 'new-sub-issue',
      label: 'New sub-issue',
      hint: receive.ok ? 'Create a child issue' : receive.error,
      disabled: !receive.ok,
      iconClass: 'fi-rr-plus-small',
      onSelect: () => {
        void promptCreateSubIssue(parentId);
      },
    },
    {
      id: 'attach-sub-issue',
      label: 'Nest an existing issue',
      hint:
        attachable.length === 0
          ? 'No other issues in this workspace'
          : `${attachable.length} available`,
      disabled: !receive.ok || attachable.length === 0,
      submenu: () =>
        workspaceEligibleSubIssues(parentId)
          .slice(0, ATTACH_MENU_CAP)
          .map((issue) => ({
            id: `attach-${issue.id}`,
            label: issue.title.trim() || issue.id,
            hint: issue.id,
            onSelect: () => applyIssueParentDrop(parentId, [issue.id]),
          })),
    },
  ];
}

/** Row / peek-more items for create and unparent. */
export function subIssueMenuItems(issue: IssueCard): IssuesContextMenuItem[] {
  const receive = canIssueReceiveSubIssues(issue.id);
  const items: IssuesContextMenuItem[] = [
    {
      id: 'add-sub-issue',
      label: 'Add sub-issue',
      disabled: !receive.ok,
      hint: receive.ok ? 'Create a child issue' : receive.error,
      onSelect: () => {
        void promptCreateSubIssue(issue.id);
      },
    },
  ];
  if (issue.parentId) {
    items.push({
      id: 'remove-from-parent',
      label: 'Remove from parent',
      onSelect: () => unparentIssueFromParent(issue.id),
    });
  }
  return items;
}
