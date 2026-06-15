/**
 * CalDAV writeback — push local creates/updates/deletes to remote servers.
 */

import { createCalendarObject, deleteCalendarObject, updateCalendarObject } from 'tsdav';
import { buildEventIcal } from './ics.js';

/**
 * Create or update a remote VEVENT from a local row.
 * @param {import('tsdav').DAVClient} client
 * @param {import('tsdav').DAVCalendar} remoteCalendar
 * @param {object} event
 */
export async function pushEventToRemote(client, remoteCalendar, event) {
  const icalData = buildEventIcal(event);
  const filename = `${event.id}.ics`;
  const href = event.remote?.href;

  if (href) {
    await updateCalendarObject({
      calendarObject: {
        url: href,
        data: icalData,
        etag: event.remote?.etag,
      },
    });
    return href;
  }

  await createCalendarObject({
    calendar: remoteCalendar,
    filename,
    iCalString: icalData,
  });

  const objectUrl = `${remoteCalendar.url}${remoteCalendar.url.endsWith('/') ? '' : '/'}${filename}`;
  return objectUrl;
}

/**
 * Delete a remote calendar object by href.
 * @param {import('tsdav').DAVClient} client
 * @param {import('tsdav').DAVCalendar} remoteCalendar
 * @param {string} href
 */
export async function deleteRemoteEvent(client, remoteCalendar, href) {
  await deleteCalendarObject({
    calendarObject: {
      url: href,
    },
  });
}
