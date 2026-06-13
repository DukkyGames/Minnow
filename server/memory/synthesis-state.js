/**
 * Per-chat message-pair counter for synthesis throttling.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMemoryDir } from './paths.js';

function statePath() {
  return path.join(getMemoryDir(), 'synthesis-state.json');
}

/** @returns {Promise<Record<string, { messagePairs: number }>>} */
async function loadState() {
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const chats = parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : {};
    return /** @type {Record<string, { messagePairs: number }>} */ (chats);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/** @param {Record<string, { messagePairs: number }>} chats */
async function saveState(chats) {
  const filePath = statePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(
    tmp,
    `${JSON.stringify({ version: 1, chats }, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(tmp, filePath);
}

/**
 * Increment message-pair counter for a chat and return the new value.
 * @param {string} chatId
 * @returns {Promise<number>}
 */
export async function incrementMessagePairs(chatId) {
  const id = String(chatId ?? '').trim();
  if (!id) return 0;
  const chats = await loadState();
  const prev = chats[id]?.messagePairs ?? 0;
  const next = prev + 1;
  chats[id] = { messagePairs: next };
  await saveState(chats);
  return next;
}

/**
 * @param {string} chatId
 * @returns {Promise<number>}
 */
export async function getMessagePairs(chatId) {
  const id = String(chatId ?? '').trim();
  if (!id) return 0;
  const chats = await loadState();
  return chats[id]?.messagePairs ?? 0;
}
