/**
 * Upcoming calendar event reminders — feeds scheduler in-app notification queue.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureMinnowLayout } from '../config/home.js';
import { calendarRemindersPath } from './paths.js';
import { listUpcomingEvents } from './store.js';
import { enqueueSchedulerNotification } from '../scheduler/delivery.js';

/** Lead time before event start to fire a reminder. */
const REMINDER_LEAD_MINUTES = 15;

/** How far ahead to scan for events on each tick. */
const SCAN_HOURS = 24;

/** @type {Promise<void>} */
let writeQueue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 */
function withWriteLock(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readSentStore() {
  await ensureMinnowLayout();
  const filePath = calendarRemindersPath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: parsed?.version ?? 1,
      sent: Array.isArray(parsed?.sent) ? parsed.sent : [],
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { version: 1, sent: [] };
    }
    throw err;
  }
}

/** @param {{ version: number; sent: object[] }} store */
async function writeSentStore(store) {
  const filePath = calendarRemindersPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/** Poll upcoming events and enqueue in-app reminders via scheduler delivery. */
export async function runCalendarReminderTick() {
  const now = Date.now();
  const leadMs = REMINDER_LEAD_MINUTES * 60 * 1000;
  const upcoming = listUpcomingEvents(SCAN_HOURS);
  let dispatched = 0;

  await withWriteLock(async () => {
    const store = await readSentStore();
    const sentKeys = new Set(store.sent.map((row) => row.key));

    for (const event of upcoming) {
      const startMs = Date.parse(event.startsAt);
      const delta = startMs - now;
      if (delta < 0 || delta > leadMs) {
        continue;
      }

      const key = `${event.recurrenceId ?? event.id}:${event.startsAt}`;
      if (sentKeys.has(key)) {
        continue;
      }

      await enqueueSchedulerNotification({
        jobId: `calendar:${key}`,
        label: 'Calendar',
        message: `Event in ${Math.max(1, Math.round(delta / 60_000))} minutes: ${event.title}`,
      });

      store.sent.unshift({ key, at: new Date().toISOString() });
      sentKeys.add(key);
      dispatched += 1;
    }

    if (store.sent.length > 500) {
      store.sent = store.sent.slice(0, 500);
    }

    if (dispatched > 0) {
      await writeSentStore(store);
    }
  });

  return { dispatched };
}

/** Poll interval for calendar reminders. */
export const CALENDAR_REMINDER_INTERVAL_MS = 60_000;

/** @type {NodeJS.Timeout | null} */
let reminderTimer = null;

/** Start calendar reminder polling loop. */
export function startCalendarReminderLoop() {
  if (reminderTimer) {
    return;
  }

  const tick = () => {
    void runCalendarReminderTick().catch((err) => {
      console.warn('[calendar] reminder tick failed:', err instanceof Error ? err.message : err);
    });
  };

  tick();
  reminderTimer = setInterval(tick, CALENDAR_REMINDER_INTERVAL_MS);
  if (typeof reminderTimer.unref === 'function') {
    reminderTimer.unref();
  }
}

/** Stop reminder loop (tests). */
export function stopCalendarReminderLoop() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}
