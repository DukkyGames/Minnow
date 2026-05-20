/**
 * Load merged LSP config from repo defaults + ~/.speedchat/lsp.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSpeedChatHome } from '../config/home.js';
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

export async function loadMergedLspConfig() {
  if (cached) return cached;

  const defaultsRaw = await fs.readFile(
    path.join(PROJECT_ROOT, 'src/lsp/defaults.json'),
    'utf8',
  );
  const defaults = JSON.parse(defaultsRaw);

  const userPath = path.join(getSpeedChatHome(), 'lsp.json');
  let user = {};
  try {
    user = JSON.parse(await fs.readFile(userPath, 'utf8'));
  } catch {
    user = await seedLspJson(defaults);
  }

  cached = mergeLspConfig(defaults, user);
  return cached;
}

export function invalidateLspConfigCache() {
  cached = null;
}

/** Write initial lsp.json with typescript enabled, others off. */
export async function seedLspJson(defaults) {
  const home = getSpeedChatHome();
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
