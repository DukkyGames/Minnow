/**
 * Email account CRUD with encrypted credentials (#12 secret-box).
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
import { emailAccountsPath, emailSecretPath, emailCacheDir } from './paths.js';

/** Default IMAP folders when none are configured. */
export const DEFAULT_FOLDERS = ['INBOX'];

/** Minimum polling interval in minutes. */
export const MIN_POLLING_MINUTES = 5;

/** Default polling interval in minutes. */
export const DEFAULT_POLLING_MINUTES = 15;

/**
 * @typedef {object} EmailAccount
 * @property {string} id
 * @property {string} label
 * @property {{ host: string, port: number, tls: boolean }} imap
 * @property {{ host: string, port: number, starttls: boolean } | undefined} smtp
 * @property {string} username
 * @property {string} [secretRef]
 * @property {string | undefined} fromAddress
 * @property {boolean} isDefault
 * @property {boolean} pollingEnabled
 * @property {number} pollingIntervalMinutes
 * @property {string[]} folders
 * @property {string} [signature] — plain text appended below new compose bodies
 */

/** Ceiling on a stored signature; anything longer is a pasted document. */
export const MAX_SIGNATURE_LENGTH = 2000;

/**
 * Validate host/port/username fields for create/update.
 * @param {Record<string, unknown>} input
 */
export function validateAccountInput(input) {
  const label = String(input.label ?? '').trim();
  const username = String(input.username ?? '').trim();
  const imapHost = String(input.imap?.host ?? input.imapHost ?? '').trim();
  const imapPort = Number(input.imap?.port ?? input.imapPort ?? 993);
  const imapTls = input.imap?.tls ?? input.imapTls ?? true;

  if (!label) {
    throw new Error('label is required');
  }
  if (!username) {
    throw new Error('username is required');
  }
  if (!imapHost) {
    throw new Error('IMAP host is required');
  }
  if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) {
    throw new Error('IMAP port must be between 1 and 65535');
  }

  let smtp;
  const smtpHost = String(input.smtp?.host ?? input.smtpHost ?? '').trim();
  if (smtpHost) {
    const smtpPort = Number(input.smtp?.port ?? input.smtpPort ?? 587);
    const starttls = input.smtp?.starttls ?? input.smtpStarttls ?? true;
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      throw new Error('SMTP port must be between 1 and 65535');
    }
    smtp = { host: smtpHost, port: smtpPort, starttls: Boolean(starttls) };
  }

  const pollingIntervalMinutes = clampPollingMinutes(
    input.pollingIntervalMinutes ?? DEFAULT_POLLING_MINUTES,
  );

  const foldersRaw = input.folders;
  const folders = Array.isArray(foldersRaw)
    ? foldersRaw.map((f) => String(f).trim()).filter(Boolean)
    : DEFAULT_FOLDERS.slice();

  return {
    label,
    username,
    imap: { host: imapHost, port: imapPort, tls: Boolean(imapTls) },
    smtp,
    fromAddress: String(input.fromAddress ?? '').trim() || undefined,
    isDefault: Boolean(input.isDefault),
    pollingEnabled: Boolean(input.pollingEnabled),
    pollingIntervalMinutes,
    folders: folders.length > 0 ? folders : DEFAULT_FOLDERS.slice(),
    signature: String(input.signature ?? '').slice(0, MAX_SIGNATURE_LENGTH),
    ...(input.followupTracking !== undefined
      ? { followupTracking: Boolean(input.followupTracking) }
      : {}),
    ...(input.styleProfileEnabled !== undefined
      ? { styleProfileEnabled: Boolean(input.styleProfileEnabled) }
      : {}),
    ...(input.categoryTabsEnabled !== undefined
      ? { categoryTabsEnabled: Boolean(input.categoryTabsEnabled) }
      : {}),
  };
}

/**
 * @param {unknown} value
 */
export function clampPollingMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_POLLING_MINUTES;
  }
  return Math.max(MIN_POLLING_MINUTES, Math.floor(n));
}

/**
 * Strip password fields from API responses.
 * @param {EmailAccount} account
 */
export function redactAccount(account) {
  if (!account || typeof account !== 'object') {
    return account;
  }
  const { secretRef, ...rest } = account;
  return {
    ...rest,
    hasPassword: Boolean(secretRef),
  };
}

async function readAccountsFile() {
  const data = await readEncryptedJsonFile(emailAccountsPath(), { version: 1, accounts: [] });
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  return { version: data.version ?? 1, accounts };
}

async function writeAccountsFile(payload) {
  await writeEncryptedJsonFile(emailAccountsPath(), payload);
}

/**
 * @returns {Promise<EmailAccount[]>}
 */
export async function listEmailAccounts() {
  const file = await readAccountsFile();
  return file.accounts;
}

/**
 * @param {string} accountId
 */
export async function getEmailAccount(accountId) {
  const accounts = await listEmailAccounts();
  return accounts.find((row) => row.id === accountId) ?? null;
}

/**
 * Read decrypted password for an account (server-only).
 * @param {string} accountId
 */
export async function readAccountPassword(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const envelope = await readEncryptedJsonFile(emailSecretPath(accountId));
  if (!isEncryptedSecretPayload(envelope)) {
    throw new Error('Email credentials are missing or corrupt');
  }
  return decryptSecretPayload(envelope);
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} [password]
 */
export async function createEmailAccount(input, password) {
  const validated = validateAccountInput(input);
  const pass = String(password ?? input.password ?? '').trim();
  if (!pass) {
    throw new Error('password is required');
  }

  const id = randomUUID();
  const secretRef = emailSecretPath(id);
  await writeEncryptedJsonFile(secretRef, await encryptSecretPayload(pass));

  const account = {
    id,
    ...validated,
    secretRef,
  };

  const file = await readAccountsFile();
  if (account.isDefault) {
    for (const row of file.accounts) {
      row.isDefault = false;
    }
  } else if (file.accounts.length === 0) {
    account.isDefault = true;
  }

  file.accounts.push(account);
  await writeAccountsFile(file);
  return account;
}

/**
 * @param {string} accountId
 * @param {Record<string, unknown>} input
 * @param {string | undefined} password
 */
export async function updateEmailAccount(accountId, input, password) {
  const file = await readAccountsFile();
  const index = file.accounts.findIndex((row) => row.id === accountId);
  if (index < 0) {
    throw new Error('Email account not found');
  }

  const existing = file.accounts[index];
  const merged = {
    ...existing,
    ...validateAccountInput({
      label: input.label ?? existing.label,
      username: input.username ?? existing.username,
      imap: input.imap ?? existing.imap,
      smtp: input.smtp ?? existing.smtp,
      fromAddress: input.fromAddress ?? existing.fromAddress,
      isDefault: input.isDefault ?? existing.isDefault,
      pollingEnabled: input.pollingEnabled ?? existing.pollingEnabled,
      pollingIntervalMinutes: input.pollingIntervalMinutes ?? existing.pollingIntervalMinutes,
      folders: input.folders ?? existing.folders,
      signature: input.signature ?? existing.signature,
      followupTracking: input.followupTracking ?? existing.followupTracking,
      styleProfileEnabled: input.styleProfileEnabled ?? existing.styleProfileEnabled,
      categoryTabsEnabled: input.categoryTabsEnabled ?? existing.categoryTabsEnabled,
    }),
    id: accountId,
    secretRef: existing.secretRef,
  };

  if (merged.isDefault) {
    for (const row of file.accounts) {
      row.isDefault = false;
    }
  }

  const pass = String(password ?? input.password ?? '').trim();
  if (pass) {
    await writeEncryptedJsonFile(emailSecretPath(accountId), await encryptSecretPayload(pass));
  }

  file.accounts[index] = merged;
  await writeAccountsFile(file);
  return merged;
}

/**
 * Close the live IMAP session first — an open socket (or Windows SQLite handle) would outlive the account.
 * @param {string} accountId
 */
export async function deleteEmailAccount(accountId) {
  const file = await readAccountsFile();
  const index = file.accounts.findIndex((row) => row.id === accountId);
  if (index < 0) {
    throw new Error('Email account not found');
  }

  const removed = file.accounts[index];
  file.accounts.splice(index, 1);

  if (removed.isDefault && file.accounts.length > 0) {
    file.accounts[0].isDefault = true;
  }

  await writeAccountsFile(file);

  try {
    await fs.unlink(emailSecretPath(accountId));
  } catch {
    /* ignore missing secret */
  }

  try {
    await fs.rm(emailCacheDir(accountId), { recursive: true, force: true });
  } catch {
    /* ignore missing cache */
  }

  try {
    const { closeImapSession, stopIdleWatcher } = await import('./imap-session.js');
    await stopIdleWatcher(accountId);
    await closeImapSession(accountId);
  } catch {
    /* ignore session teardown failures */
  }

  try {
    const { deleteMailDb } = await import('./store.js');
    deleteMailDb(accountId);
  } catch {
    /* ignore missing mail store */
  }

  try {
    const { deleteAutomationsForAccount } = await import('./automations.js');
    await deleteAutomationsForAccount(accountId);
  } catch {
    /* ignore automation cleanup failures */
  }

  return { deleted: true };
}

/**
 * Resolve default account when none is specified.
 */
export async function resolveDefaultAccountId() {
  const accounts = await listEmailAccounts();
  if (accounts.length === 0) {
    return null;
  }
  const def = accounts.find((row) => row.isDefault);
  return (def ?? accounts[0]).id;
}
