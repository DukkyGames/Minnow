/**
 * Paths under ~/.minnow for webhook subscriptions, secrets, and delivery logs.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** @returns {string} */
export function webhooksStorePath() {
  return path.join(getMinnowHome(), 'webhooks.json');
}

/** @returns {string} */
export function webhooksDeliveriesPath() {
  return path.join(getMinnowHome(), 'webhooks-deliveries.json');
}

/** @returns {string} */
export function webhooksSecretsDir() {
  return path.join(getMinnowHome(), 'webhooks', 'secrets');
}

/**
 * Relative secret ref stored on subscriptions (no absolute paths).
 * @param {string} subscriptionId
 * @returns {string}
 */
export function secretRefForSubscription(subscriptionId) {
  return `webhooks/secrets/${subscriptionId}.json`;
}

/**
 * Absolute path for an encrypted signing secret file.
 * @param {string} subscriptionId
 * @returns {string}
 */
export function secretFilePath(subscriptionId) {
  return path.join(webhooksSecretsDir(), `${subscriptionId}.json`);
}
