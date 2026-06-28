/**
 * Calendar sync router — CalDAV password accounts only.
 */

import { getCalDavAccountRow } from './store.js';
import { syncCalDavAccount } from './caldav.js';

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
  if (backend !== 'caldav') {
    throw new Error(`Unsupported sync backend "${backend}" — reconnect with CalDAV`);
  }
  return syncCalDavAccount(accountId);
}
