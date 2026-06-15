/**
 * Short-lived TTS audio cache under ~/.minnow/tts-cache/.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Cache entry TTL — 15 minutes. */
const CACHE_TTL_MS = 15 * 60_000;

/**
 * Resolve cache directory, creating it when missing.
 */
export async function getTtsCacheDir() {
  const dir = path.join(getMinnowHome(), 'tts-cache');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Hash synthesis parameters for cache lookup.
 * @param {string} text
 * @param {string} voice
 * @param {number} speed
 * @param {string} format
 */
export function hashTtsParams(text, voice, speed, format) {
  const payload = `${text}\0${voice}\0${speed}\0${format}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Read cached audio if still fresh.
 * @param {string} id
 */
export async function readTtsCache(id) {
  const dir = await getTtsCacheDir();
  const filePath = path.join(dir, `${id}.audio`);
  const metaPath = path.join(dir, `${id}.meta.json`);
  try {
    const metaRaw = await fs.readFile(metaPath, 'utf8');
    const meta = JSON.parse(metaRaw);
    if (Date.now() - Number(meta.createdAt || 0) > CACHE_TTL_MS) {
      await fs.unlink(filePath).catch(() => {});
      await fs.unlink(metaPath).catch(() => {});
      return null;
    }
    const data = await fs.readFile(filePath);
    return {
      data,
      mime: typeof meta.mime === 'string' ? meta.mime : 'audio/mpeg',
    };
  } catch {
    return null;
  }
}

/**
 * Store synthesized audio in the cache.
 * @param {string} id
 * @param {Buffer} data
 * @param {string} mime
 */
export async function writeTtsCache(id, data, mime) {
  const dir = await getTtsCacheDir();
  const filePath = path.join(dir, `${id}.audio`);
  const metaPath = path.join(dir, `${id}.meta.json`);
  await fs.writeFile(filePath, data);
  await fs.writeFile(
    metaPath,
    JSON.stringify({ createdAt: Date.now(), mime }, null, 0),
  );
}

/**
 * Look up cached audio by synthesis hash.
 * @param {string} text
 * @param {string} voice
 * @param {number} speed
 * @param {string} format
 */
export async function getCachedSynthesis(text, voice, speed, format) {
  const id = hashTtsParams(text, voice, speed, format);
  const cached = await readTtsCache(id);
  if (!cached) return null;
  return { id, ...cached };
}

/**
 * Save synthesis result to cache and return cache id.
 * @param {string} text
 * @param {string} voice
 * @param {number} speed
 * @param {string} format
 * @param {Buffer} data
 * @param {string} mime
 */
export async function putCachedSynthesis(text, voice, speed, format, data, mime) {
  const id = hashTtsParams(text, voice, speed, format);
  await writeTtsCache(id, data, mime);
  return id;
}
