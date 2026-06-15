/**
 * Poll scheduler notifications and surface them via MinnowOS menubar badges.
 */

import { detectLocalServer } from '../tools/client';
import {
  ackSchedulerNotification,
  fetchSchedulerNotifications,
} from './client';

const POLL_INTERVAL_MS = 30_000;

/** Notification ids already delivered this session (dedupe). */
const deliveredIds = new Set<string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Deliver one notification to the settings app badge and ack on the server. */
async function deliverNotification(
  row: Awaited<ReturnType<typeof fetchSchedulerNotifications>>[number],
): Promise<void> {
  if (deliveredIds.has(row.id)) {
    return;
  }
  deliveredIds.add(row.id);

  const { noteAgentMessage } = await import('../os/instances');
  noteAgentMessage('scheduler', `${row.label}: ${row.message}`);

  try {
    await ackSchedulerNotification(row.id);
  } catch {
    /* best-effort ack */
  }
}

/** Single poll pass for unacked scheduler reminders. */
export async function pollSchedulerNotifications(): Promise<void> {
  const ok = await detectLocalServer();
  if (!ok) {
    return;
  }

  const rows = await fetchSchedulerNotifications();
  for (const row of rows) {
    await deliverNotification(row);
  }
}

/** Start background polling while the SPA is open. */
export function startSchedulerNotificationPoll(): void {
  if (pollTimer) {
    return;
  }

  void pollSchedulerNotifications();
  pollTimer = setInterval(() => {
    void pollSchedulerNotifications();
  }, POLL_INTERVAL_MS);
}

/** Stop polling (tests). */
export function stopSchedulerNotificationPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
