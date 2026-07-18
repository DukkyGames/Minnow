/**
 * Per-sender remote-image allowlist — persisted in
 * ~/.minnow/email/image-allowlist.json.
 *
 * Remote content is blocked for every message (see `remote-content.js`). This
 * is the "always load images from this sender" escape hatch, keyed on the
 * sender's email address so the decision follows the correspondent rather than
 * an individual message.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { emailImageAllowlistPath } from './paths.js';

/**
 * Reduce a From header to a bare, comparable address.
 * `"Acme News" <News@Acme.COM>` -> `news@acme.com`
 * @param {string | null | undefined} from
 */
export function normalizeSender(from) {
  const raw = String(from ?? '').trim();
  const angled = /<([^>]+)>/.exec(raw);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

/** @returns {Promise<string[]>} */
export async function listImageAllowlist() {
  try {
    const raw = await fs.readFile(emailImageAllowlistPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.senders) ? parsed.senders.map(normalizeSender).filter(Boolean) : [];
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * @param {string[]} senders
 */
async function writeImageAllowlist(senders) {
  const filePath = emailImageAllowlistPath();
  // Don't depend on ensureMinnowLayout having run; a first-write on a fresh
  // profile must not fail just because nothing has touched ~/.minnow/email yet.
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(
    tmp,
    `${JSON.stringify({ version: 1, senders, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(tmp, filePath);
}

/**
 * @param {string} from
 * @returns {Promise<string[]>} the updated allowlist
 */
export async function allowImagesFromSender(from) {
  const sender = normalizeSender(from);
  if (!sender) {
    throw new Error('sender is required');
  }
  const senders = await listImageAllowlist();
  if (!senders.includes(sender)) {
    senders.push(sender);
    await writeImageAllowlist(senders);
  }
  return senders;
}

/**
 * @param {string} from
 * @returns {Promise<string[]>} the updated allowlist
 */
export async function blockImagesFromSender(from) {
  const sender = normalizeSender(from);
  const senders = await listImageAllowlist();
  const next = senders.filter((row) => row !== sender);
  if (next.length !== senders.length) {
    await writeImageAllowlist(next);
  }
  return next;
}

/**
 * @param {string} from
 * @returns {Promise<boolean>}
 */
export async function isSenderAllowed(from) {
  const sender = normalizeSender(from);
  if (!sender) return false;
  return (await listImageAllowlist()).includes(sender);
}
