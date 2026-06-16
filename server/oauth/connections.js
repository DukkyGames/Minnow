/**
 * OAuth connection CRUD and encrypted token storage.
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  decryptSecretPayload,
  encryptSecretPayload,
  isEncryptedSecretPayload,
  readEncryptedJsonFile,
  writeEncryptedJsonFile,
} from '../security/secret-box.js';
import { oauthConnectionsPath, oauthSecretPath } from './paths.js';

/**
 * @typedef {object} OAuthConnection
 * @property {string} id
 * @property {'google' | 'microsoft'} provider
 * @property {string} email
 * @property {string} label
 * @property {{ email: boolean, calendar: boolean }} services
 * @property {string} secretRef
 * @property {string} [emailAccountId]
 * @property {string} [calendarAccountId]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} OAuthTokenBundle
 * @property {string} accessToken
 * @property {string} [refreshToken]
 * @property {number} expiresAt
 * @property {string} scopes
 */

async function readConnectionsFile() {
  const data = await readEncryptedJsonFile(oauthConnectionsPath(), { version: 1, connections: [] });
  const connections = Array.isArray(data.connections) ? data.connections : [];
  return { version: data.version ?? 1, connections };
}

async function writeConnectionsFile(payload) {
  await writeEncryptedJsonFile(oauthConnectionsPath(), payload);
}

/**
 * Strip secrets from API responses.
 * @param {OAuthConnection} connection
 */
export function redactConnection(connection) {
  if (!connection || typeof connection !== 'object') {
    return connection;
  }
  const { secretRef, ...rest } = connection;
  return {
    ...rest,
    hasTokens: Boolean(secretRef),
  };
}

/** @returns {Promise<OAuthConnection[]>} */
export async function listOAuthConnections() {
  const file = await readConnectionsFile();
  return file.connections;
}

/** @param {string} connectionId */
export async function getOAuthConnection(connectionId) {
  const connections = await listOAuthConnections();
  return connections.find((row) => row.id === connectionId) ?? null;
}

/** Find connection by provider + email (dedupe). */
export async function findOAuthConnectionByEmail(provider, email) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const connections = await listOAuthConnections();
  return (
    connections.find(
      (row) => row.provider === provider && String(row.email).trim().toLowerCase() === normalized,
    ) ?? null
  );
}

/**
 * Read decrypted tokens for a connection.
 * @param {string} connectionId
 * @returns {Promise<OAuthTokenBundle>}
 */
export async function readConnectionTokens(connectionId) {
  const connection = await getOAuthConnection(connectionId);
  if (!connection) {
    throw new Error('OAuth connection not found');
  }
  const envelope = await readEncryptedJsonFile(oauthSecretPath(connectionId));
  if (!isEncryptedSecretPayload(envelope)) {
    throw new Error('OAuth tokens are missing or corrupt');
  }
  const raw = await decryptSecretPayload(envelope);
  const parsed = JSON.parse(raw);
  return {
    accessToken: String(parsed.accessToken ?? ''),
    refreshToken: parsed.refreshToken ? String(parsed.refreshToken) : undefined,
    expiresAt: Number(parsed.expiresAt) || 0,
    scopes: String(parsed.scopes ?? ''),
  };
}

/**
 * Persist encrypted token bundle.
 * @param {string} connectionId
 * @param {OAuthTokenBundle} tokens
 */
export async function writeConnectionTokens(connectionId, tokens) {
  const payload = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
  });
  await writeEncryptedJsonFile(oauthSecretPath(connectionId), await encryptSecretPayload(payload));
}

/**
 * Create or update a connection after successful OAuth.
 * @param {object} input
 */
export async function upsertOAuthConnection(input) {
  const provider = input.provider;
  const email = String(input.email ?? '').trim();
  if (!email) {
    throw new Error('email is required for OAuth connection');
  }

  const existing = await findOAuthConnectionByEmail(provider, email);
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const secretRef = oauthSecretPath(id);

  const connection = {
    id,
    provider,
    email,
    label: String(input.label ?? email).trim() || email,
    services: {
      email: input.services?.email !== false,
      calendar: input.services?.calendar !== false,
    },
    secretRef,
    emailAccountId: input.emailAccountId ?? existing?.emailAccountId,
    calendarAccountId: input.calendarAccountId ?? existing?.calendarAccountId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writeConnectionTokens(id, input.tokens);

  const file = await readConnectionsFile();
  const index = file.connections.findIndex((row) => row.id === id);
  if (index >= 0) {
    file.connections[index] = connection;
  } else {
    file.connections.push(connection);
  }
  await writeConnectionsFile(file);
  return connection;
}

/**
 * Patch linked account ids on a connection.
 * @param {string} connectionId
 * @param {{ emailAccountId?: string, calendarAccountId?: string }} patch
 */
export async function patchOAuthConnectionLinks(connectionId, patch) {
  const file = await readConnectionsFile();
  const index = file.connections.findIndex((row) => row.id === connectionId);
  if (index < 0) {
    throw new Error('OAuth connection not found');
  }
  const row = file.connections[index];
  if (patch.emailAccountId) {
    row.emailAccountId = patch.emailAccountId;
  }
  if (patch.calendarAccountId) {
    row.calendarAccountId = patch.calendarAccountId;
  }
  row.updatedAt = new Date().toISOString();
  file.connections[index] = row;
  await writeConnectionsFile(file);
  return row;
}

/** @param {string} connectionId */
export async function deleteOAuthConnection(connectionId) {
  const file = await readConnectionsFile();
  const index = file.connections.findIndex((row) => row.id === connectionId);
  if (index < 0) {
    throw new Error('OAuth connection not found');
  }
  file.connections.splice(index, 1);
  await writeConnectionsFile(file);
  try {
    await fs.unlink(oauthSecretPath(connectionId));
  } catch {
    /* ignore */
  }
  return { deleted: true };
}
