/**
 * Calendar sync router — CalDAV password vs OAuth Google/Microsoft APIs.
 */

import { getCalDavAccountRow } from './store.js';
import { syncCalDavAccount } from './caldav.js';
import { syncGoogleCalendarAccount } from './google-api.js';
import { syncGraphCalendarAccount } from './graph-calendar.js';

/**
 * Sync a calendar account using its configured backend.
 * @param {string} accountId
 */
export async function syncCalendarAccount(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('Calendar account not found');
  }

  const backend = row.syncBackend ?? 'caldav';
  if (backend === 'google') {
    return syncGoogleCalendarAccount(accountId);
  }
  if (backend === 'microsoft') {
    return syncGraphCalendarAccount(accountId);
  }
  return syncCalDavAccount(accountId);
}
