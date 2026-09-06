/**
 * Peek copy for a linked GitHub issue: last-sync time, or Needs push.
 *
 * Remote drift is intentionally invisible until Sync runs. This module only
 * reads local watermarks.
 */

import { formatRelativeTime } from '../notifications/preview';
import { issueNeedsGithubPush } from './github-sync-plan';
import type { IssueCard } from '../types';

/** Caption after `#n ·` on the GitHub row. Empty when the card is not linked. */
export function githubSyncCaption(issue: IssueCard, now = Date.now()): string {
  const link = issue.github;
  if (!link) return '';
  if (issueNeedsGithubPush(issue)) return 'Needs push';
  return `synced ${formatRelativeTime(link.syncedAt, now)}`;
}
