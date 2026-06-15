/**
 * Fire-and-forget webhook delivery queue with retries and bounded logs.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readConfigJson } from '../config/store.js';
import {
  DELIVERY_TIMEOUT_MS,
  isAllowedEvent,
  MAX_DELIVERY_LOG,
  MAX_PENDING_DELIVERIES,
  MAX_DELIVERY_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from './constants.js';
import { webhooksDeliveriesPath } from './paths.js';
import {
  getSubscriptionById,
  listEnabledSubscriptionsForEvent,
  readSubscriptionSecret,
} from './store.js';
import {
  buildWebhookBody,
  buildWebhookHeaders,
  computeWebhookSignature,
} from './sign.js';
import { sanitizeError, validateWebhookUrl } from './ssrf.js';

/**
 * @typedef {object} WebhookDelivery
 * @property {string} id
 * @property {string} subscriptionId
 * @property {string} event
 * @property {number} [statusCode]
 * @property {string} [error]
 * @property {number} durationMs
 * @property {string} attemptedAt
 */

/**
 * @typedef {object} PendingDelivery
 * @property {string} deliveryId
 * @property {string} subscriptionId
 * @property {string} url
 * @property {string | null} secret
 * @property {string} event
 * @property {unknown} data
 * @property {number} attempt
 */

/** @type {PendingDelivery[]} */
const pendingQueue = [];

/** @type {WebhookDelivery[]} */
let deliveryLog = [];

let workerRunning = false;
let deliveriesLoaded = false;

/**
 * @returns {Promise<{ allowLocalHttp: boolean }>}
 */
async function loadWebhookOptions() {
  const config = (await readConfigJson('config.json')) ?? {};
  const webhooks =
    config.webhooks && typeof config.webhooks === 'object'
      ? /** @type {{ allowLocalHttp?: boolean }} */ (config.webhooks)
      : {};
  return { allowLocalHttp: webhooks.allowLocalHttp === true };
}

/**
 * @returns {Promise<void>}
 */
async function ensureDeliveriesLoaded() {
  if (deliveriesLoaded) return;
  deliveriesLoaded = true;
  const filePath = webhooksDeliveriesPath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.deliveries)) {
      deliveryLog = parsed.deliveries.slice(-MAX_DELIVERY_LOG);
    }
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      console.warn('[webhooks] could not load delivery log:', err);
    }
  }
}

/**
 * @returns {Promise<void>}
 */
async function persistDeliveries() {
  const filePath = webhooksDeliveriesPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    version: 1,
    deliveries: deliveryLog.slice(-MAX_DELIVERY_LOG),
  };
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * @param {WebhookDelivery} entry
 */
async function recordDelivery(entry) {
  await ensureDeliveriesLoaded();
  deliveryLog.push(entry);
  if (deliveryLog.length > MAX_DELIVERY_LOG) {
    deliveryLog = deliveryLog.slice(-MAX_DELIVERY_LOG);
  }
  try {
    await persistDeliveries();
  } catch (err) {
    console.warn('[webhooks] could not persist delivery log:', err);
  }
}

/**
 * @param {PendingDelivery} job
 * @param {{ allowLocalHttp: boolean }} options
 * @returns {Promise<{ statusCode?: number, error?: string, durationMs: number }>}
 */
function postWebhook(job, options) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - started });
    };

    validateWebhookUrl(job.url, options)
      .then((validatedUrl) => {
        const body = buildWebhookBody(job.event, job.data);
        const timestampSeconds = Math.floor(Date.now() / 1000);
        const signature = job.secret
          ? computeWebhookSignature(job.secret, timestampSeconds, body)
          : undefined;
        const headers = buildWebhookHeaders({
          event: job.event,
          deliveryId: job.deliveryId,
          timestampSeconds,
          signature,
        });

        const parsed = new URL(validatedUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.request(
          validatedUrl,
          {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Length': Buffer.byteLength(body, 'utf8'),
            },
            timeout: DELIVERY_TIMEOUT_MS,
          },
          (res) => {
            res.resume();
            finish({ statusCode: res.statusCode ?? 0 });
          },
        );

        req.on('timeout', () => {
          req.destroy(new Error('Delivery timed out'));
        });
        req.on('error', (err) => {
          finish({ error: sanitizeError(err instanceof Error ? err.message : String(err)) });
        });
        req.write(body);
        req.end();
      })
      .catch((err) => {
        finish({
          error: sanitizeError(err instanceof Error ? err.message : String(err)),
        });
      });
  });
}

/**
 * @param {PendingDelivery} job
 * @param {{ allowLocalHttp: boolean }} options
 */
async function runDeliveryAttempt(job, options) {
  const result = await postWebhook(job, options);
  const success =
    typeof result.statusCode === 'number' &&
    result.statusCode >= 200 &&
    result.statusCode < 300;

  if (success || job.attempt >= MAX_DELIVERY_ATTEMPTS) {
    await recordDelivery({
      id: job.deliveryId,
      subscriptionId: job.subscriptionId,
      event: job.event,
      statusCode: result.statusCode,
      error: result.error,
      durationMs: result.durationMs,
      attemptedAt: new Date().toISOString(),
    });
    return;
  }

  const delay = RETRY_BACKOFF_MS[Math.min(job.attempt - 1, RETRY_BACKOFF_MS.length - 1)] ?? 1_000;
  setTimeout(() => {
    pendingQueue.push({ ...job, attempt: job.attempt + 1 });
    if (pendingQueue.length > MAX_PENDING_DELIVERIES) {
      const dropped = pendingQueue.shift();
      if (dropped) {
        console.warn('[webhooks] delivery queue overflow; dropped oldest pending job');
      }
    }
    void ensureWorker();
  }, delay);
}

async function ensureWorker() {
  if (workerRunning) return;
  workerRunning = true;
  const options = await loadWebhookOptions();
  try {
    while (pendingQueue.length > 0) {
      const job = pendingQueue.shift();
      if (!job) break;
      await runDeliveryAttempt(job, options);
    }
  } finally {
    workerRunning = false;
    if (pendingQueue.length > 0) {
      void ensureWorker();
    }
  }
}

/**
 * Enqueue deliveries for all enabled subscriptions matching the event.
 * Returns immediately without blocking callers.
 * @param {string} event
 * @param {unknown} data
 */
export function fireAndForget(event, data) {
  if (!isAllowedEvent(event)) {
    return;
  }

  void (async () => {
    try {
      const subs = await listEnabledSubscriptionsForEvent(event);
      if (subs.length === 0) {
        return;
      }

      for (const sub of subs) {
        const secret = sub.secretRef ? await readSubscriptionSecret(sub.id) : null;
        const job = {
          deliveryId: randomUUID(),
          subscriptionId: sub.id,
          url: sub.url,
          secret,
          event,
          data,
          attempt: 1,
        };
        pendingQueue.push(job);
        if (pendingQueue.length > MAX_PENDING_DELIVERIES) {
          pendingQueue.shift();
          console.warn('[webhooks] delivery queue overflow; dropped oldest pending job');
        }
      }
      void ensureWorker();
    } catch (err) {
      console.warn('[webhooks] fireAndForget failed:', err);
    }
  })();
}

/**
 * Fire webhook.test for a single subscription (awaitable for API routes).
 * @param {string} subscriptionId
 */
export async function deliverTest(subscriptionId) {
  const sub = await getSubscriptionById(subscriptionId);
  if (!sub) {
    throw new Error('Subscription not found');
  }

  const secret = sub.secretRef ? await readSubscriptionSecret(sub.id) : null;
  const job = {
    deliveryId: randomUUID(),
    subscriptionId: sub.id,
    url: sub.url,
    secret,
    event: 'webhook.test',
    data: { message: 'Test ping from Minnow' },
    attempt: 1,
  };
  const options = await loadWebhookOptions();
  await runDeliveryAttempt(job, options);
}

/**
 * @returns {Promise<WebhookDelivery[]>}
 */
export async function listRecentDeliveries() {
  await ensureDeliveriesLoaded();
  return [...deliveryLog].reverse().slice(0, 100);
}

/** Reset in-memory queue/log (tests only). */
export function resetWebhookDeliveryStateForTests() {
  pendingQueue.length = 0;
  deliveryLog = [];
  workerRunning = false;
  deliveriesLoaded = false;
}
