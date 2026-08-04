/**
 * Editor selection → IssueCodeRef via context menu "Link to issue…" (MIN-261).
 */

import {
  appendIssueLinks,
  collectIssues,
  findIssueById,
  getNextIssueIdPreview,
  getWorkspaceProjectKey,
} from '../state/issues-store';
import { getWorkspacePath } from '../state/workspace';
import type { IssueCodeRef } from '../types';
import { appPrompt } from './app-dialog';

/**
 * Prompt for an issue id (lists recent open issues) and append a code ref.
 * Returns true when a link was added.
 */
export async function linkSelectionToIssue(input: {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}): Promise<boolean> {
  const path = input.path.trim().replace(/\\/g, '/');
  if (!path || !input.text.trim()) return false;

  const openIssues = collectIssues({
    scope: 'current_workspace',
    workspacePath: getWorkspacePath(),
    hideDone: true,
  }).slice(0, 12);

  const projectKey = getWorkspaceProjectKey(getWorkspacePath());
  const hint =
    openIssues.length > 0
      ? `Recent: ${openIssues.map((i) => `${i.id} ${i.title.slice(0, 28)}`).join(' | ')}`
      : `Enter an issue id such as ${getNextIssueIdPreview()}`;

  const raw = await appPrompt(`Link selection to issue\n${hint}`, openIssues[0]?.id ?? `${projectKey}-`);
  if (raw == null) return false;
  const issueId = raw.trim();
  if (!issueId) return false;

  const issue = findIssueById(issueId);
  if (!issue) {
    void import('./toast').then((m) => m.showToast(`Unknown issue "${issueId}"`, 'error'));
    return false;
  }

  const ref: IssueCodeRef = {
    path,
    startLine: Math.max(1, input.startLine),
    endLine: Math.max(input.startLine, input.endLine),
    snippet: input.text.slice(0, 2000),
  };
  appendIssueLinks(issue.id, { codeRefs: [ref] });
  void import('./toast').then((m) => m.showToast(`Linked to ${issue.id}`, 'success'));

  // Refresh Issues detail if that app is open.
  void import('./issues-detail').then((m) => m.refreshIssueDetailIfOpen());
  return true;
}
