/**
 * OAuth-backed calendar account helpers (Google / Microsoft Graph sync).
 */

import { randomUUID } from 'node:crypto';
import {
  deleteCalDavAccountRow,
  getCalDavAccountRow,
  listCalDavAccountRows,
  upsertCalDavAccountRow,
} from './store.js';

/**
 * Find calendar account linked to an OAuth connection.
 * @param {string} oauthConnectionId
 */
export function findCalendarAccountByOAuthConnection(oauthConnectionId) {
  const rows = listCalDavAccountRows();
  return rows.find((row) => row.oauthConnectionId === oauthConnectionId) ?? null;
}

/**
 * Create a calendar sync account for OAuth (no CalDAV password).
 * @param {{ oauthConnectionId: string, provider: 'google' | 'microsoft', label: string, username: string }} input
 */
export function createOAuthCalendarAccount(input) {
  const oauthConnectionId = String(input.oauthConnectionId ?? '').trim();
  const provider = input.provider;
  const username = String(input.username ?? '').trim();
  const label = String(input.label ?? '').trim() || username;
  if (!oauthConnectionId || !username) {
    throw new Error('oauthConnectionId and username are required');
  }
  if (provider !== 'google' && provider !== 'microsoft') {
    throw new Error('provider must be google or microsoft');
  }

  const existing = findCalendarAccountByOAuthConnection(oauthConnectionId);
  if (existing) {
    return existing;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const syncBackend = provider === 'microsoft' ? 'microsoft' : 'google';

  upsertCalDavAccountRow({
    id,
    label,
    url: `oauth://${provider}/calendar`,
    username,
    secretRef: '',
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
    syncBackend,
    oauthConnectionId,
    provider,
  });

  return getCalDavAccountRow(id);
}

/** @param {string} accountId */
export function deleteOAuthCalendarAccount(accountId) {
  const row = getCalDavAccountRow(accountId);
  if (!row) {
    throw new Error('Calendar account not found');
  }
  if (row.syncBackend === 'caldav') {
    throw new Error('Cannot delete password CalDAV account via OAuth helper');
  }
  return deleteCalDavAccountRow(accountId);
}
