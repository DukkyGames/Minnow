/**
 * Fetch and import ICS feeds from remote https URLs (e.g. Google secret iCal links).
 */

import { assertResolvablePublicHost, validateCaldavUrl } from './caldav-ssrf.js';
import { importIcsToCalendar, parseIcsContent } from './ics.js';
import { createCalendar, listCalendars } from './store.js';

const MAX_ICS_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Read calendar display name from raw ICS when present.
 * @param {string} content
 */
function readIcsCalendarName(content) {
  const match = String(content).match(/^X-WR-CALNAME:(.+)$/m);
  if (!match) {
    return '';
  }
  return match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Fetch ICS text from a public https URL with SSRF guards.
 * @param {string} url
 * @param {{ allowLocalHttp?: boolean, fetchFn?: typeof fetch }} [options]
 */
export async function fetchIcsContentFromUrl(url, options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const validated = await validateCaldavUrl(url, { allowLocalHttp: options.allowLocalHttp === true });
  const parsed = new URL(validated);
  await assertResolvablePublicHost(parsed.hostname);

  const response = await fetchFn(validated, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: 'text/calendar, text/plain, application/octet-stream, */*',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch iCal feed (HTTP ${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_ICS_BYTES) {
    throw new Error('iCal feed is too large (max 10 MB)');
  }

  const content = await response.text();
  if (Buffer.byteLength(content, 'utf8') > MAX_ICS_BYTES) {
    throw new Error('iCal feed is too large (max 10 MB)');
  }

  const trimmed = content.trim();
  if (!trimmed.includes('BEGIN:VCALENDAR')) {
    throw new Error('URL did not return a valid iCal feed');
  }

  return trimmed;
}

/**
 * Import an ICS feed URL into a calendar (creates one when needed).
 * @param {{ url: string; calendarId?: string; calendarName?: string; allowLocalHttp?: boolean; fetchFn?: typeof fetch }} input
 */
export async function importIcsFromUrl(input) {
  const url = String(input.url ?? '').trim();
  if (!url) {
    throw new Error('iCal URL is required');
  }

  const content = await fetchIcsContentFromUrl(url, {
    allowLocalHttp: input.allowLocalHttp === true,
    fetchFn: input.fetchFn,
  });

  let calendarId = String(input.calendarId ?? '').trim();
  let calendar = null;

  if (!calendarId) {
    const name =
      String(input.calendarName ?? '').trim() ||
      readIcsCalendarName(content) ||
      'Imported calendar';
    calendar = createCalendar({ name, source: 'ics' });
    calendarId = calendar.id;
  }

  const events = importIcsToCalendar(calendarId, content);
  if (!calendar) {
    calendar = listCalendars().find((row) => row.id === calendarId) ?? null;
  }

  return {
    imported: events.length,
    calendarId,
    calendar,
    previewCount: parseIcsContent(content).length,
  };
}
