/**
 * Provision email and calendar accounts after OAuth connect.
 */

import { createOAuthEmailAccount, deleteEmailAccount, findEmailAccountByOAuthConnection } from '../email/accounts.js';
import {
  createOAuthCalendarAccount,
  deleteOAuthCalendarAccount,
  findCalendarAccountByOAuthConnection,
} from '../calendar/oauth-accounts.js';
import { deleteOAuthConnection, patchOAuthConnectionLinks } from './connections.js';

/**
 * Create or update linked email/calendar rows for a connection.
 * @param {import('./connections.js').OAuthConnection} connection
 */
export async function provisionOAuthConnection(connection) {
  let emailAccountId = connection.emailAccountId;
  let calendarAccountId = connection.calendarAccountId;

  if (connection.services.email) {
    const existing = await findEmailAccountByOAuthConnection(connection.id);
    if (existing) {
      emailAccountId = existing.id;
    } else {
      const account = await createOAuthEmailAccount({
        oauthConnectionId: connection.id,
        provider: connection.provider,
        label: connection.label,
        username: connection.email,
        fromAddress: connection.email,
      });
      emailAccountId = account.id;
    }
  }

  if (connection.services.calendar) {
    const existingCal = await findCalendarAccountByOAuthConnection(connection.id);
    if (existingCal) {
      calendarAccountId = existingCal.id;
    } else {
      const calAccount = await createOAuthCalendarAccount({
        oauthConnectionId: connection.id,
        provider: connection.provider,
        label: connection.label,
        username: connection.email,
      });
      calendarAccountId = calAccount.id;
    }
  }

  await patchOAuthConnectionLinks(connection.id, {
    emailAccountId,
    calendarAccountId,
  });

  return { emailAccountId, calendarAccountId };
}

/**
 * Disconnect OAuth connection and remove linked accounts.
 * @param {string} connectionId
 */
export async function disconnectOAuthConnection(connectionId) {
  const { getOAuthConnection } = await import('./connections.js');
  const connection = await getOAuthConnection(connectionId);
  if (!connection) {
    throw new Error('OAuth connection not found');
  }

  if (connection.emailAccountId) {
    try {
      await deleteEmailAccount(connection.emailAccountId);
    } catch {
      /* account may already be gone */
    }
  }

  if (connection.calendarAccountId) {
    try {
      await deleteOAuthCalendarAccount(connection.calendarAccountId);
    } catch {
      /* ignore */
    }
  }

  return deleteOAuthConnection(connectionId);
}
