/**
 * Webhook subscription persistence and encrypted signing secrets.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  readEncryptedJsonFile,
  writeEncryptedJsonFile,
} from '../security/secret-box.js';
import { isSubscribableEvent } from './constants.js';
import { validateWebhookUrl } from './ssrf.js';
import {
  secretFilePath,
  secretRefForSubscription,
  webhooksStorePath,
} from './paths.js';

/**
 * @typedef {object} WebhookSubscription
 * @property {string} id
 * @property {string} label
 * @property {string} url
 * @property {string[]} events
 * @property {boolean} enabled
 * @property {string} secretRef
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} WebhookStoreFile
 * @property {number} version
 * @property {WebhookSubscription[]} subscriptions
 */

const STORE_VERSION = 1;

/**
 * @param {string} filePath
 * @param {unknown} data
 */
async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * @returns {Promise<WebhookStoreFile>}
 */
async function readStoreFile() {
  const filePath = webhooksStorePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.subscriptions)) {
      return { version: STORE_VERSION, subscriptions: [] };
    }
    return {
      version: STORE_VERSION,
      subscriptions: parsed.subscriptions,
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { version: STORE_VERSION, subscriptions: [] };
    }
    throw err;
  }
}

/**
 * @param {WebhookStoreFile} store
 */
async function writeStoreFile(store) {
  await writeJsonAtomic(webhooksStorePath(), {
    version: STORE_VERSION,
    subscriptions: store.subscriptions,
  });
}

/**
 * @param {WebhookSubscription} sub
 */
export function toPublicSubscription(sub) {
  return {
    id: sub.id,
    label: sub.label,
    url: sub.url,
    events: [...sub.events],
    enabled: sub.enabled,
    hasSecret: Boolean(sub.secretRef),
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

/**
 * @returns {Promise<ReturnType<typeof toPublicSubscription>[]>}
 */
export async function listSubscriptions() {
  const store = await readStoreFile();
  return store.subscriptions.map(toPublicSubscription);
}

/**
 * @param {string} id
 * @returns {Promise<WebhookSubscription | null>}
 */
export async function getSubscriptionById(id) {
  const store = await readStoreFile();
  return store.subscriptions.find((s) => s.id === id) ?? null;
}

/**
 * @param {string} id
 * @returns {Promise<string | null>}
 */
export async function readSubscriptionSecret(id) {
  const filePath = secretFilePath(id);
  try {
    const data = await readEncryptedJsonFile(filePath, { secret: '' });
    const secret = typeof data.secret === 'string' ? data.secret : '';
    return secret || null;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * @param {string} id
 * @param {string} secret
 */
async function writeSubscriptionSecret(id, secret) {
  const filePath = secretFilePath(id);
  if (!secret.trim()) {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        throw err;
      }
    }
    return;
  }
  await writeEncryptedJsonFile(filePath, { secret: secret.trim() });
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeEvents(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('events must be an array');
  }
  const events = [...new Set(raw.map((e) => String(e).trim()).filter(Boolean))];
  if (events.length === 0) {
    throw new Error('At least one event is required');
  }
  const invalid = events.filter((e) => !isSubscribableEvent(e));
  if (invalid.length > 0) {
    throw new Error(`Invalid events: ${invalid.join(', ')}`);
  }
  return events;
}

/**
 * @param {object} input
 * @param {{ allowLocalHttp?: boolean }} options
 * @returns {Promise<ReturnType<typeof toPublicSubscription>>}
 */
export async function createSubscription(input, options = {}) {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const urlRaw = typeof input.url === 'string' ? input.url : '';
  const secret = typeof input.secret === 'string' ? input.secret : '';
  const enabled = input.enabled !== false;

  if (!label) {
    throw new Error('label is required');
  }

  const url = await validateWebhookUrl(urlRaw, options);
  const events = normalizeEvents(input.events);
  const id = randomUUID();
  const now = new Date().toISOString();

  /** @type {WebhookSubscription} */
  const sub = {
    id,
    label,
    url,
    events,
    enabled,
    secretRef: secret.trim() ? secretRefForSubscription(id) : '',
    createdAt: now,
    updatedAt: now,
  };

  if (secret.trim()) {
    await writeSubscriptionSecret(id, secret);
  }

  const store = await readStoreFile();
  store.subscriptions.push(sub);
  await writeStoreFile(store);
  return toPublicSubscription(sub);
}

/**
 * @param {string} id
 * @param {object} input
 * @param {{ allowLocalHttp?: boolean }} options
 * @returns {Promise<ReturnType<typeof toPublicSubscription>>}
 */
export async function updateSubscription(id, input, options = {}) {
  const store = await readStoreFile();
  const index = store.subscriptions.findIndex((s) => s.id === id);
  if (index < 0) {
    throw new Error('Subscription not found');
  }

  const existing = store.subscriptions[index];
  const label =
    typeof input.label === 'string' && input.label.trim()
      ? input.label.trim()
      : existing.label;
  const url =
    typeof input.url === 'string' && input.url.trim()
      ? await validateWebhookUrl(input.url, options)
      : existing.url;
  const events = input.events !== undefined ? normalizeEvents(input.events) : existing.events;
  const enabled = input.enabled !== undefined ? input.enabled !== false : existing.enabled;

  if (typeof input.secret === 'string') {
    const trimmed = input.secret.trim();
    if (trimmed) {
      await writeSubscriptionSecret(id, trimmed);
      existing.secretRef = secretRefForSubscription(id);
    } else if (input.clearSecret === true) {
      await writeSubscriptionSecret(id, '');
      existing.secretRef = '';
    }
  }

  existing.label = label;
  existing.url = url;
  existing.events = events;
  existing.enabled = enabled;
  existing.updatedAt = new Date().toISOString();
  store.subscriptions[index] = existing;
  await writeStoreFile(store);
  return toPublicSubscription(existing);
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteSubscription(id) {
  const store = await readStoreFile();
  const index = store.subscriptions.findIndex((s) => s.id === id);
  if (index < 0) {
    return false;
  }
  store.subscriptions.splice(index, 1);
  await writeStoreFile(store);
  try {
    await fs.unlink(secretFilePath(id));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      throw err;
    }
  }
  return true;
}

/**
 * @param {string} event
 * @returns {Promise<WebhookSubscription[]>}
 */
export async function listEnabledSubscriptionsForEvent(event) {
  const store = await readStoreFile();
  return store.subscriptions.filter((s) => s.enabled && s.events.includes(event));
}
