/**
 * Memory-only, single-use companion pairing challenges.
 */

import crypto from 'node:crypto';
import { createDevice, sanitizeDeviceName } from './device-store.js';

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const PAIRING_CODE_DIGITS = 6;
const PAIRING_CODE_RE = /^\d{6}$/;
const ATTEMPT_WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS_PER_SOURCE = 10;
const MAX_ACTIVE_CHALLENGES = 100;
const MAX_CODE_ALLOCATION_ATTEMPTS = 32;

/** @type {Map<string, { deviceName: string, createdAt: number, expiresAt: number }>} */
const challenges = new Map();
/** @type {Map<string, number[]>} */
const attempts = new Map();

export class PairingError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'PairingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function prune(now) {
  for (const [code, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(code);
  }
  for (const [source, timestamps] of attempts) {
    const recent = timestamps.filter((timestamp) => timestamp > now - ATTEMPT_WINDOW_MS);
    if (recent.length) attempts.set(source, recent);
    else attempts.delete(source);
  }
}

function recordAttempt(source, now) {
  prune(now);
  const key = source || 'unknown';
  const recent = attempts.get(key) ?? [];
  if (recent.length >= MAX_ATTEMPTS_PER_SOURCE) {
    throw new PairingError('Too many pairing attempts', 429, 'pairing_throttled');
  }
  recent.push(now);
  attempts.set(key, recent);
}

/** Strip non-digits and require exactly six numeric characters. */
export function normalizePairingCode(value) {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/\D/g, '');
  return PAIRING_CODE_RE.test(digits) ? digits : '';
}

/**
 * @param {{ randomInt?: (min: number, max: number) => number }} deps
 */
function allocatePairingCode(deps = {}) {
  const randomInt = deps.randomInt ?? ((min, max) => crypto.randomInt(min, max));
  const upper = 10 ** PAIRING_CODE_DIGITS;
  for (let attempt = 0; attempt < MAX_CODE_ALLOCATION_ATTEMPTS; attempt += 1) {
    const code = String(randomInt(0, upper)).padStart(PAIRING_CODE_DIGITS, '0');
    if (!challenges.has(code)) return code;
  }
  throw new PairingError('Could not allocate pairing code', 503, 'pairing_capacity');
}

/**
 * @param {unknown} deviceName
 * @param {{ now?: () => number, randomInt?: (min: number, max: number) => number }} [deps]
 */
export function createPairingChallenge(deviceName, deps = {}) {
  const name = sanitizeDeviceName(deviceName);
  if (!name) throw new PairingError('A device name is required', 400, 'invalid_device_name');
  const now = (deps.now ?? Date.now)();
  prune(now);
  if (challenges.size >= MAX_ACTIVE_CHALLENGES) {
    throw new PairingError('Too many active pairings', 429, 'pairing_capacity');
  }
  const code = allocatePairingCode(deps);
  const expiresAt = now + PAIRING_TTL_MS;
  challenges.set(code, { deviceName: name, createdAt: now, expiresAt });
  return { code, deviceName: name, expiresAt };
}

/**
 * Consume a challenge and persist a new device. The challenge is removed
 * before persistence so a storage failure cannot make a secret reusable.
 * @param {{ code?: unknown, source?: string }} input
 * @param {{ now?: () => number, createDevice?: typeof createDevice }} [deps]
 */
export function exchangePairingChallenge(input, deps = {}) {
  const now = (deps.now ?? Date.now)();
  recordAttempt(input.source ?? 'unknown', now);

  const code = normalizePairingCode(input.code);
  if (!code) {
    throw new PairingError('Pairing code is required', 400, 'invalid_pairing_request');
  }

  const challenge = challenges.get(code);
  if (!challenge || challenge.expiresAt <= now) {
    challenges.delete(code);
    throw new PairingError('Pairing code is invalid or expired', 401, 'invalid_pairing_code');
  }

  challenges.delete(code);
  const created = (deps.createDevice ?? createDevice)(challenge.deviceName);
  return {
    ...created,
    pairedAt: new Date(now).toISOString(),
  };
}

/** Reset memory-only state (tests only). */
export function resetPairingState() {
  challenges.clear();
  attempts.clear();
}
