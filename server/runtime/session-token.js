/**
 * Per-boot session token gating /api/* access. Generated once per process,
 * persisted best-effort so the headless CLI (a separate process) can read it.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const TOKEN_FILE_NAME = 'session-token';

/** @type {string | null} */
let cachedToken = null;

/** Best-effort restrictive permissions on Unix; never throws. */
function chmodSafe(filePath, mode) {
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    /* ignore on Windows or unsupported FS */
  }
}

function writeSessionTokenFile(token) {
  try {
    const home = getMinnowHome();
    fs.mkdirSync(home, { recursive: true });
    const filePath = path.join(home, TOKEN_FILE_NAME);
    fs.writeFileSync(filePath, token, { encoding: 'utf8', mode: 0o600 });
    chmodSafe(filePath, 0o600);
  } catch {
    /* best effort — headless CLI falls back to --token/MINNOW_TOKEN */
  }
}

/**
 * Lazily generate (and memoize) this process's session token.
 * @returns {string}
 */
export function getSessionToken() {
  if (cachedToken) return cachedToken;
  cachedToken = crypto.randomBytes(32).toString('hex');
  writeSessionTokenFile(cachedToken);
  return cachedToken;
}

/**
 * Read the token file written by a running server (used by the headless CLI).
 * @returns {string} Empty string when absent/unreadable.
 */
export function readSessionTokenFile() {
  try {
    const home = getMinnowHome();
    const filePath = path.join(home, TOKEN_FILE_NAME);
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Constant-time token comparison (guards length first, since
 * crypto.timingSafeEqual throws on mismatched buffer lengths).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeEqualToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const HEAD_MARKER = '</head>';

/**
 * Inject the session token into a served HTML document so the browser can
 * read it same-origin; a cross-origin attacker page never sees it.
 * Also injects MINNOW_SERVER_ENGINE so the SPA can gate main-chat sends
 * without an extra round-trip (Phase 1 / MIN-359).
 * @param {string} html
 * @param {string} token
 * @returns {string}
 */
export function injectSessionTokenScript(html, token) {
  const engineOn =
    process.env.MINNOW_SERVER_ENGINE === '1' ||
    process.env.MINNOW_SERVER_ENGINE === 'true' ||
    process.env.MINNOW_SERVER_ENGINE === 'yes' ||
    process.env.MINNOW_SERVER_ENGINE === 'on';
  const script = `<script>window.__MINNOW_SESSION_TOKEN__=${JSON.stringify(token)};window.__MINNOW_SERVER_ENGINE__=${engineOn ? 'true' : 'false'};</script>`;
  const idx = html.indexOf(HEAD_MARKER);
  if (idx === -1) return script + html;
  return html.slice(0, idx) + script + html.slice(idx);
}

/** Reset cached token (tests only). */
export function resetSessionTokenCache() {
  cachedToken = null;
}
