/**
 * RRULE expansion for calendar date ranges (via rrule package).
 */

import rrulePkg from 'rrule';

const { RRule } = rrulePkg;

/**
 * Parse an RFC 5545 RRULE string into RRule options.
 * @param {string} rruleText
 * @param {Date} dtstart
 */
function buildRRule(rruleText, dtstart) {
  const cleaned = rruleText.replace(/^RRULE:/i, '').trim();
  const options = RRule.parseString(cleaned);
  return new RRule({ ...options, dtstart });
}

/**
 * Clone an event for a specific occurrence start/end.
 * @param {object} base
 * @param {Date} occurrenceStart
 */
function cloneOccurrence(base, occurrenceStart) {
  const durationMs = Date.parse(base.endsAt) - Date.parse(base.startsAt);
  const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
  const suffix = occurrenceStart.toISOString().slice(0, 10);

  return {
    ...base,
    id: `${base.id}::${suffix}`,
    startsAt: occurrenceStart.toISOString(),
    endsAt: occurrenceEnd.toISOString(),
    recurrenceId: base.id,
    isOccurrence: true,
  };
}

/**
 * Expand recurring events into concrete occurrences within [rangeStart, rangeEnd].
 * Non-recurring events that overlap the range are included as-is.
 * @param {object[]} events
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 */
export function expandEventsInRange(events, rangeStart, rangeEnd) {
  const output = [];

  for (const event of events) {
    if (!event.rrule) {
      const startMs = Date.parse(event.startsAt);
      const endMs = Date.parse(event.endsAt);
      if (endMs > rangeStart.getTime() && startMs < rangeEnd.getTime()) {
        output.push(event);
      }
      continue;
    }

    try {
      const dtstart = new Date(event.startsAt);
      const rule = buildRRule(event.rrule, dtstart);
      const dates = rule.between(rangeStart, rangeEnd, true);
      for (const date of dates) {
        output.push(cloneOccurrence(event, date));
      }
    } catch {
      // Fall back to the master event when RRULE parsing fails.
      output.push(event);
    }
  }

  output.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return output;
}

/**
 * Find free time gaps between events on a given day.
 * @param {object[]} events — expanded occurrences for the day
 * @param {Date} dayStart
 * @param {Date} dayEnd
 * @param {number} minMinutes
 */
export function findFreeTimeSlots(events, dayStart, dayEnd, minMinutes = 30) {
  const busy = events
    .map((event) => ({
      start: Date.parse(event.startsAt),
      end: Date.parse(event.endsAt),
    }))
    .filter((slot) => slot.end > dayStart.getTime() && slot.start < dayEnd.getTime())
    .sort((a, b) => a.start - b.start);

  const minMs = minMinutes * 60 * 1000;
  const slots = [];
  let cursor = dayStart.getTime();

  for (const block of busy) {
    const gapEnd = Math.min(block.start, dayEnd.getTime());
    if (gapEnd - cursor >= minMs) {
      slots.push({
        startsAt: new Date(cursor).toISOString(),
        endsAt: new Date(gapEnd).toISOString(),
      });
    }
    cursor = Math.max(cursor, block.end);
  }

  if (dayEnd.getTime() - cursor >= minMs) {
    slots.push({
      startsAt: new Date(cursor).toISOString(),
      endsAt: dayEnd.toISOString(),
    });
  }

  return slots;
}
