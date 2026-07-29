/**
 * Persistent, named companion devices. Device secrets are returned once and
 * only a SHA-256 digest is written to ~/.minnow/auth/devices.json.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const SCHEMA_VERSION = 1;
const DEVICE_TOKEN_RE = /^minnow_device_([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/;

function authDir() {
  return path.join(getMinnowHome(), 'auth');
}

function devicesPath() {
  return path.join(authDir(), 'devices.json');
}

function chmodSafe(filePath, mode) {
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    /* Windows and some filesystems do not implement Unix permissions. */
  }
}

function ensureAuthDir() {
  const dir = authDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSafe(dir, 0o700);
  return dir;
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, devices: [] };
}

function readStore() {
  let raw;
  try {
    raw = fs.readFileSync(devicesPath(), 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return emptyStore();
    throw err;
  }

  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    parsed.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(parsed.devices) ||
    parsed.devices.some(
      (device) =>
        !device ||
        typeof device.id !== 'string' ||
        typeof device.name !== 'string' ||
        typeof device.tokenHash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(device.tokenHash) ||
        typeof device.createdAt !== 'string',
    )
  ) {
    throw new Error('Invalid companion device store');
  }
  return parsed;
}

function writeStore(store) {
  const dir = ensureAuthDir();
  const target = devicesPath();
  const temporary = path.join(
    dir,
    `.devices.json.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    chmodSafe(temporary, 0o600);
    fs.renameSync(temporary, target);
    chmodSafe(target, 0o600);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* The rename removed the temporary file, or creation failed. */
    }
  }
}

/**
 * Normalize a user-visible device name and reject empty input.
 * @param {unknown} value
 */
export function sanitizeDeviceName(value) {
  if (typeof value !== 'string') return null;
  const name = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  return name || null;
}

/** @param {string} token */
export function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Create and persist a named device, returning its secret exactly once.
 * @param {string} name
 * @param {{ now?: () => number, randomBytes?: (size: number) => Buffer }} [deps]
 */
export function createDevice(name, deps = {}) {
  const sanitizedName = sanitizeDeviceName(name);
  if (!sanitizedName) throw new TypeError('A device name is required');

  const randomBytes = deps.randomBytes ?? crypto.randomBytes;
  const now = deps.now ?? Date.now;
  const id = randomBytes(12).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const token = `minnow_device_${id}.${secret}`;
  const device = {
    id,
    name: sanitizedName,
    tokenHash: hashDeviceToken(token),
    createdAt: new Date(now()).toISOString(),
  };
  const store = readStore();
  store.devices.push(device);
  writeStore(store);
  return {
    token,
    device: { id: device.id, name: device.name, createdAt: device.createdAt },
  };
}

/** List public device records, never token hashes. */
export function listDevices() {
  return readStore().devices.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
}

/**
 * Authenticate against the current on-disk records. Reading for each request
 * makes a completed synchronous revocation effective on the very next request.
 * @param {unknown} token
 */
export function authenticateDeviceToken(token) {
  if (typeof token !== 'string' || token.length > 256) return null;
  const match = DEVICE_TOKEN_RE.exec(token);
  if (!match) return null;
  const id = match[1];
  const device = readStore().devices.find((candidate) => candidate.id === id);
  if (!device) return null;

  const expected = Buffer.from(device.tokenHash, 'hex');
  const actual = Buffer.from(hashDeviceToken(token), 'hex');
  if (!crypto.timingSafeEqual(actual, expected)) return null;
  return { kind: 'device', deviceId: device.id, deviceName: device.name };
}

/**
 * Remove a device synchronously before returning.
 * @param {string} id
 */
export function revokeDevice(id) {
  const store = readStore();
  const nextDevices = store.devices.filter((device) => device.id !== id);
  if (nextDevices.length === store.devices.length) return false;
  writeStore({ ...store, devices: nextDevices });
  return true;
}
