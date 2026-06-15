/**
 * manage_calendar server tool handler.
 */

import {
  createEvent,
  deleteEvent,
  getEventById,
  listCalendars,
  listEvents,
  updateEvent,
} from '../calendar/store.js';
import { findFreeTimeSlots } from '../calendar/recurrence.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * @param {Record<string, unknown>} args
 */
export async function toolManageCalendar(args) {
  const action = String(args.action ?? 'list').trim().toLowerCase();

  if (action === 'list') {
    const from = args.from ? String(args.from) : new Date().toISOString();
    const to =
      args.to ??
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const all = listEvents({
      calendarId: args.calendarId ? String(args.calendarId) : undefined,
      from,
      to,
      expandRecurrence: true,
    });

    if (all.length === 0) {
      return 'No events found in the requested range.';
    }

    const limitRaw = args.limit !== undefined ? Number(args.limit) : DEFAULT_LIST_LIMIT;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limitRaw)))
      : DEFAULT_LIST_LIMIT;
    const offsetRaw = args.offset !== undefined ? Number(args.offset) : 0;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const total = all.length;
    const page = all.slice(offset, offset + limit);
    const truncated = offset + page.length < total;

    const lines = page.map(
      (event) =>
        `- ${event.startsAt} → ${event.endsAt}: ${event.title} (id=${event.id}, calendar=${event.calendarId})`,
    );

    const header =
      truncated || offset > 0
        ? `Events (${page.length} of ${total}, offset ${offset}):`
        : `Events (${page.length}):`;

    let body = `${header}\n${lines.join('\n')}`;
    if (truncated) {
      body += `\n(${total} total — use offset=${offset + limit} to fetch the next page.)`;
    }
    return body;
  }

  if (action === 'create') {
    const title = String(args.title ?? '').trim();
    if (!title) {
      return 'Error: title is required for create';
    }

    const calendars = listCalendars();
    const calendarId = args.calendarId
      ? String(args.calendarId)
      : calendars[0]?.id;
    if (!calendarId) {
      return 'Error: no calendars available';
    }

    const startsAt = args.startsAt ? String(args.startsAt) : undefined;
    const endsAt = args.endsAt ? String(args.endsAt) : undefined;
    if (!startsAt || !endsAt) {
      return 'Error: startsAt and endsAt are required for create';
    }

    const event = createEvent({
      title,
      calendarId,
      startsAt,
      endsAt,
      description: args.description ? String(args.description) : undefined,
      location: args.location ? String(args.location) : undefined,
      allDay: Boolean(args.allDay),
      rrule: args.rrule ? String(args.rrule) : undefined,
      source: 'agent',
    });

    return `Created event "${event.title}" (${event.id}) from ${event.startsAt} to ${event.endsAt}.`;
  }

  if (action === 'update') {
    const eventId = String(args.eventId ?? '').trim();
    if (!eventId) {
      return 'Error: eventId is required for update';
    }
    const existing = getEventById(eventId);
    if (!existing) {
      return `Error: event not found (${eventId})`;
    }

    const event = updateEvent(eventId, {
      title: args.title !== undefined ? String(args.title) : undefined,
      startsAt: args.startsAt !== undefined ? String(args.startsAt) : undefined,
      endsAt: args.endsAt !== undefined ? String(args.endsAt) : undefined,
      description: args.description !== undefined ? String(args.description) : undefined,
      location: args.location !== undefined ? String(args.location) : undefined,
      allDay: args.allDay !== undefined ? Boolean(args.allDay) : undefined,
      rrule: args.rrule !== undefined ? String(args.rrule) : undefined,
    });

    return `Updated event "${event.title}" (${event.id}).`;
  }

  if (action === 'delete') {
    const eventId = String(args.eventId ?? '').trim();
    const confirmed = args.confirmed === true || args.confirm === true;
    if (!eventId) {
      return 'Error: eventId is required for delete';
    }
    if (!confirmed) {
      return 'Deletion requires confirmation. Re-run with confirmed: true after user approval.';
    }

    const existing = getEventById(eventId);
    if (!existing) {
      return `Error: event not found (${eventId})`;
    }

    deleteEvent(eventId);
    return `Deleted event "${existing.title}" (${eventId}).`;
  }

  if (action === 'find_free_time') {
    const date = args.date ? String(args.date) : new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${date}T09:00:00.000Z`);
    const dayEnd = new Date(`${date}T17:00:00.000Z`);
    const minMinutes = args.minMinutes ? Number(args.minMinutes) : 30;
    const events = listEvents({
      calendarId: args.calendarId ? String(args.calendarId) : undefined,
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
      expandRecurrence: true,
    });
    const slots = findFreeTimeSlots(events, dayStart, dayEnd, minMinutes).slice(0, 10);
    if (slots.length === 0) {
      return `No free slots of at least ${minMinutes} minutes on ${date}.`;
    }
    const lines = slots.map((slot) => `- ${slot.startsAt} → ${slot.endsAt}`);
    return `Free time on ${date}:\n${lines.join('\n')}`;
  }

  return `Error: unknown action "${action}". Use list, create, update, delete, or find_free_time.`;
}
