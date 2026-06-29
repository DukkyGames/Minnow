/**
 * Encrypted MCP integration secrets under ~/.minnow/mcp/secrets.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import {
  readEncryptedJsonFile,
  writeEncryptedJsonFile,
} from '../security/secret-box.js';

const EMPTY_SECRETS = { context7ApiKey: '' };

/** Best-effort restrictive permissions on secrets files (Unix). */
async function chmodSecrets(filePath) {
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    /* ignore on Windows */
  }
}

/**
 * @returns {string}
 */
function secretsFilePath() {
  return path.join(getMinnowHome(), 'mcp', 'secrets.json');
}

/**
 * @returns {Promise<{ context7ApiKey: string }>}
 */
export async function readMcpSecrets() {
  const file = secretsFilePath();
  try {
    const secrets = await readEncryptedJsonFile(file, EMPTY_SECRETS);
    return {
      context7ApiKey:
        typeof secrets.context7ApiKey === 'string' ? secrets.context7ApiKey : '',
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { ...EMPTY_SECRETS };
    }
    throw err;
  }
}

/**
 * @param {{ context7ApiKey?: string }} body
 * @returns {Promise<{ hasContext7ApiKey: boolean }>}
 */
export async function updateMcpSecrets(body) {
  const secrets = await readMcpSecrets();
  if (body.context7ApiKey !== undefined) {
    secrets.context7ApiKey =
      typeof body.context7ApiKey === 'string' ? body.context7ApiKey : '';
  }

  const dir = path.dirname(secretsFilePath());
  await fs.mkdir(dir, { recursive: true });
  const file = secretsFilePath();
  await writeEncryptedJsonFile(file, secrets);
  await chmodSecrets(file);

  return {
    hasContext7ApiKey: secrets.context7ApiKey.trim().length > 0,
  };
}

/**
 * Resolve Context7 API key from process env or encrypted MCP secrets.
 * @returns {Promise<string>}
 */
export async function getContext7ApiKey() {
  const fromEnv = process.env.CONTEXT7_API_KEY?.trim() ?? '';
  if (fromEnv) return fromEnv;
  const secrets = await readMcpSecrets();
  return secrets.context7ApiKey.trim();
}

const SECRET_REF = /^\$\{secret:([a-zA-Z0-9_]+)\}$/;

/**
 * Replace ${secret:key} placeholders in MCP transport env with stored values.
 * @param {Record<string, string> | undefined} env
 * @returns {Promise<Record<string, string>>}
 */
export async function resolveMcpTransportEnv(env) {
  if (!env || typeof env !== 'object') return {};
  const secrets = await readMcpSecrets();
  const resolved = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const match = value.match(SECRET_REF);
    if (match) {
      const secretKey = match[1];
      const stored = secrets[secretKey];
      resolved[key] = typeof stored === 'string' ? stored : '';
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
