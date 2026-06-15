/**
 * HMAC-SHA256 signing for outgoing webhook deliveries.
 */

import crypto from 'node:crypto';

/**
 * Compute sha256 HMAC signature for a webhook body.
 * Payload format: `{unixSeconds}.{rawJsonBody}`
 * @param {string} secret
 * @param {number} timestampSeconds
 * @param {string} rawJsonBody
 * @returns {string} hex digest prefixed with algorithm
 */
export function computeWebhookSignature(secret, timestampSeconds, rawJsonBody) {
  const payload = `${timestampSeconds}.${rawJsonBody}`;
  const digest = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Build outbound webhook headers.
 * @param {{
 *   event: string,
 *   deliveryId: string,
 *   timestampSeconds: number,
 *   signature?: string,
 * }} params
 * @returns {Record<string, string>}
 */
export function buildWebhookHeaders({ event, deliveryId, timestampSeconds, signature }) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Minnow-Webhook/1.0',
    'X-Minnow-Event': event,
    'X-Minnow-Delivery': deliveryId,
    'X-Minnow-Timestamp': String(timestampSeconds),
  };
  if (signature) {
    headers['X-Minnow-Signature'] = signature;
  }
  return headers;
}

/**
 * Build the JSON body envelope for a webhook event.
 * @param {string} event
 * @param {unknown} data
 * @returns {string}
 */
export function buildWebhookBody(event, data) {
  const envelope = {
    event,
    timestamp: new Date().toISOString(),
    data: data ?? {},
  };
  return JSON.stringify(envelope);
}
