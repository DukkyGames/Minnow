/**
 * Load merged LSP config from repo defaults + ~/.minnow/lsp.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMinnowHome } from '../config/home.js';
import { mergeLspConfig } from '../../src/lsp/merge-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

let cached = null;
let builtinIdsCache = null;

/** Server ids shipped in src/lsp/defaults.json (built-ins, not user-defined). */
export async function getBuiltinLspIds() {
  if (builtinIdsCache) return builtinIdsCache;
  const defaultsRaw = await fs.readFile(
    path.join(PROJECT_ROOT, 'src/lsp/defaults.json'),
    'utf8',
  );
  const defaults = JSON.parse(defaultsRaw);
  builtinIdsCache = new Set(Object.keys(defaults.lsp ?? {}));
  return builtinIdsCache;
}

/**
 * Add missing built-in stubs to an existing ~/.minnow/lsp.json (upgrade path).
 * Never overwrites keys already present; excludes test-only `fake`.
 */
export function migrateLspJsonMissingBuiltins(defaults, userPayload) {
  const defaultLsp = defaults.lsp ?? {};
  const userLsp =
    userPayload?.lsp && typeof userPayload.lsp === 'object' ? userPayload.lsp : {};
  const nextLsp = { ...userLsp };
  let mutated = false;

  for (const [id, cfg] of Object.entries(defaultLsp)) {
    if (id === 'fake') continue;
    if (Object.prototype.hasOwnProperty.call(nextLsp, id)) continue;
    nextLsp[id] = {
      disabled: cfg?.defaultEnabled === true ? false : true,
    };
    mutated = true;
  }

  if (!mutated) {
    return { payload: userPayload, mutated: false };
  }

  return {
    payload: { ...userPayload, lsp: nextLsp },
    mutated: true,
  };
}

export async function loadMergedLspConfig() {
  if (cached) return cached;

  const defaultsRaw = await fs.readFile(
    path.join(PROJECT_ROOT, 'src/lsp/defaults.json'),
    'utf8',
  );
  const defaults = JSON.parse(defaultsRaw);

  const userPath = path.join(getMinnowHome(), 'lsp.json');
  let user = {};
  let userFromDisk = false;
  try {
    user = JSON.parse(await fs.readFile(userPath, 'utf8'));
    userFromDisk = true;
  } catch {
    user = await seedLspJson(defaults);
  }

  if (userFromDisk) {
    const { payload, mutated } = migrateLspJsonMissingBuiltins(defaults, user);
    if (mutated) {
      await fs.writeFile(userPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      invalidateLspConfigCache();
      user = payload;
    }
  }

  cached = mergeLspConfig(defaults, user);
  return cached;
}

export function invalidateLspConfigCache() {
  cached = null;
}

/** Write initial lsp.json with typescript enabled, others off. */
export async function seedLspJson(defaults) {
  const home = getMinnowHome();
  const userPath = path.join(home, 'lsp.json');
  const lsp = {};
  for (const [id, cfg] of Object.entries(defaults.lsp ?? {})) {
    lsp[id] = {
      disabled: cfg.defaultEnabled === true ? false : true,
    };
  }
  lsp.fake = { disabled: false };
  const payload = { enabled: true, lsp };
  await fs.writeFile(userPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}
