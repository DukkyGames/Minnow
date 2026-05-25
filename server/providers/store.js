/**
 * Provider registry under ~/.minnow/providers/<id>/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import { buildAuthHeaders, secretsFlags } from './auth-headers.js';
import { getDefaultPaths, getProviderCapabilities } from './paths.js';
import {
  validateApiKind,
  validateAuthStyle,
  validateBaseUrl,
  validateProviderId,
} from './validate.js';

const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234';
const LM_STUDIO_LOCAL_ID = 'lm-studio-local';

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
function providersRoot() {
  return path.join(getMinnowHome(), 'providers');
}

/**
 * @param {string} id
 * @returns {string}
 */
function providerDir(id) {
  validateProviderId(id);
  return path.join(providersRoot(), id);
}

/**
 * @param {object} profile
 * @param {{ hasApiKey: boolean, hasBearer: boolean }} flags
 */
export function toProviderPublic(profile, flags) {
  const caps = getProviderCapabilities(profile.apiKind);
  const supportsModelLoadUnload =
    profile.supportsModelLoadUnload !== undefined
      ? profile.supportsModelLoadUnload === true
      : caps.supportsModelLoadUnload;

  return {
    id: profile.id,
    label: profile.label,
    baseUrl: profile.baseUrl,
    apiKind: profile.apiKind,
    enabled: profile.enabled !== false,
    authStyle: profile.authStyle || 'bearer',
    modelsPath: profile.modelsPath,
    chatCompletionsPath: profile.chatCompletionsPath,
    supportsModelLoadUnload,
    modelsLoadPath: profile.modelsLoadPath,
    modelsUnloadPath: profile.modelsUnloadPath,
    customHeaders: profile.customHeaders || {},
    constrainedToolCalls:
      profile.constrainedToolCalls === true
        ? true
        : profile.constrainedToolCalls === false
          ? false
          : undefined,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    hasApiKey: flags.hasApiKey,
    hasBearer: flags.hasBearer,
  };
}

/**
 * @param {string} id
 */
async function readProfile(id) {
  const file = path.join(providerDir(id), 'profile.json');
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

/**
 * @param {string} id
 */
async function readSecrets(id) {
  const file = path.join(providerDir(id), 'secrets.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { apiKey: '', bearerToken: '', headerOverrides: {} };
    }
    throw err;
  }
}

/**
 * @param {string} id
 * @param {object} profile
 */
async function writeProfile(id, profile) {
  const dir = providerDir(id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'profile.json');
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

/**
 * @param {string} id
 * @param {object} secrets
 */
async function writeSecrets(id, secrets) {
  const dir = providerDir(id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'secrets.json');
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
  await chmodSecrets(file);
}

/**
 * @returns {Promise<string[]>}
 */
async function listProviderIds() {
  const root = providersRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * @returns {Promise<string>}
 */
export async function getActiveProviderId() {
  const meta = (await readConfigJson('config.json')) ?? {};
  if (typeof meta.activeProviderId === 'string' && meta.activeProviderId) {
    return meta.activeProviderId;
  }
  return LM_STUDIO_LOCAL_ID;
}

/**
 * @param {string} id
 */
export async function setActiveProviderId(id) {
  validateProviderId(id);
  const ids = await listProviderIds();
  if (!ids.includes(id)) {
    throw new Error('Provider not found');
  }
  const meta = (await readConfigJson('config.json')) ?? {};
  await writeConfigJson('config.json', {
    ...meta,
    activeProviderId: id,
  });
}

/**
 * @param {string} [legacyServerUrl]
 */
async function seedLmStudioLocal(legacyServerUrl) {
  const baseUrl = validateBaseUrl(legacyServerUrl || DEFAULT_LM_STUDIO_URL);
  const now = new Date().toISOString();
  const paths = getDefaultPaths('lm-studio-v0');
  const profile = {
    id: LM_STUDIO_LOCAL_ID,
    label: 'LM Studio (local)',
    baseUrl,
    apiKind: 'lm-studio-v0',
    enabled: true,
    authStyle: 'bearer',
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
    supportsModelLoadUnload: true,
    modelsLoadPath: paths.modelsLoadPath,
    modelsUnloadPath: paths.modelsUnloadPath,
    customHeaders: {},
    createdAt: now,
    updatedAt: now,
  };
  await writeProfile(LM_STUDIO_LOCAL_ID, profile);
  await writeSecrets(LM_STUDIO_LOCAL_ID, {
    apiKey: '',
    bearerToken: '',
    headerOverrides: {},
  });

  const meta = (await readConfigJson('config.json')) ?? {};
  if (!meta.activeProviderId) {
    await writeConfigJson('config.json', {
      ...meta,
      activeProviderId: LM_STUDIO_LOCAL_ID,
    });
  }
}

/**
 * Ensure provider registry exists; seed default LM Studio provider when empty.
 */
/**
 * Backfill load/unload capability fields on existing provider profiles.
 */
async function migrateProviderCapabilities() {
  const ids = await listProviderIds();
  for (const id of ids) {
    let profile;
    try {
      profile = await readProfile(id);
    } catch {
      continue;
    }
    const caps = getProviderCapabilities(profile.apiKind);
    const paths = getDefaultPaths(profile.apiKind, profile);
    let changed = false;

    if (profile.supportsModelLoadUnload === undefined) {
      profile.supportsModelLoadUnload = caps.supportsModelLoadUnload;
      changed = true;
    }
    if (caps.supportsModelLoadUnload) {
      if (!profile.modelsLoadPath && paths.modelsLoadPath) {
        profile.modelsLoadPath = paths.modelsLoadPath;
        changed = true;
      }
      if (!profile.modelsUnloadPath && paths.modelsUnloadPath) {
        profile.modelsUnloadPath = paths.modelsUnloadPath;
        changed = true;
      }
    }
    if (changed) {
      profile.updatedAt = new Date().toISOString();
      await writeProfile(id, profile);
    }
  }
}

export async function ensureProviderRegistry() {
  await fs.mkdir(providersRoot(), { recursive: true });
  const ids = await listProviderIds();
  if (ids.length === 0) {
    const meta = (await readConfigJson('config.json')) ?? {};
    const legacyUrl =
      typeof meta.serverUrl === 'string' && meta.serverUrl.trim()
        ? meta.serverUrl
        : DEFAULT_LM_STUDIO_URL;
    await seedLmStudioLocal(legacyUrl);
    return;
  }

  await migrateProviderCapabilities();
}

/**
 * @returns {Promise<{ providers: object[], activeProviderId: string }>}
 */
export async function listProviders() {
  await ensureProviderRegistry();
  const ids = await listProviderIds();
  const providers = [];
  for (const id of ids.sort()) {
    try {
      const profile = await readProfile(id);
      const secrets = await readSecrets(id);
      providers.push(toProviderPublic(profile, secretsFlags(secrets)));
    } catch {
      /* skip broken provider dirs */
    }
  }
  let activeProviderId = await getActiveProviderId();
  if (!providers.some((p) => p.id === activeProviderId) && providers.length > 0) {
    activeProviderId = providers[0].id;
    await setActiveProviderId(activeProviderId);
  }
  return { providers, activeProviderId };
}

/**
 * @param {string} id
 */
export async function getProvider(id) {
  await ensureProviderRegistry();
  validateProviderId(id);
  const profile = await readProfile(id);
  const secrets = await readSecrets(id);
  return toProviderPublic(profile, secretsFlags(secrets));
}

/**
 * @param {object} body
 */
export async function createProvider(body) {
  await ensureProviderRegistry();
  const id = validateProviderId(body.id);
  const ids = await listProviderIds();
  if (ids.includes(id)) {
    throw new Error('Provider already exists');
  }

  const apiKind = validateApiKind(body.apiKind || 'lm-studio-v0');
  const baseUrl = validateBaseUrl(body.baseUrl);
  const authStyle = validateAuthStyle(body.authStyle);
  const paths = getDefaultPaths(apiKind, body);
  const caps = getProviderCapabilities(apiKind);
  const now = new Date().toISOString();

  const profile = {
    id,
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : id,
    baseUrl,
    apiKind,
    enabled: body.enabled !== false,
    authStyle,
    modelsPath: body.modelsPath || paths.modelsPath,
    chatCompletionsPath: body.chatCompletionsPath || paths.chatCompletionsPath,
    supportsModelLoadUnload:
      body.supportsModelLoadUnload !== undefined
        ? body.supportsModelLoadUnload === true
        : caps.supportsModelLoadUnload,
    modelsLoadPath: body.modelsLoadPath || paths.modelsLoadPath,
    modelsUnloadPath: body.modelsUnloadPath || paths.modelsUnloadPath,
    customHeaders:
      body.customHeaders && typeof body.customHeaders === 'object' ? body.customHeaders : {},
    createdAt: now,
    updatedAt: now,
  };

  await writeProfile(id, profile);
  await writeSecrets(id, { apiKey: '', bearerToken: '', headerOverrides: {} });

  const meta = (await readConfigJson('config.json')) ?? {};
  if (!meta.activeProviderId) {
    await setActiveProviderId(id);
  }

  return getProvider(id);
}

/**
 * @param {string} id
 * @param {object} body
 */
export async function updateProvider(id, body) {
  validateProviderId(id);
  const profile = await readProfile(id);
  const now = new Date().toISOString();

  if (body.label !== undefined) {
    profile.label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim() : profile.label;
  }
  if (body.baseUrl !== undefined) {
    profile.baseUrl = validateBaseUrl(body.baseUrl);
  }
  if (body.apiKind !== undefined) {
    profile.apiKind = validateApiKind(body.apiKind);
    const paths = getDefaultPaths(profile.apiKind, body);
    profile.modelsPath = body.modelsPath || paths.modelsPath;
    profile.chatCompletionsPath = body.chatCompletionsPath || paths.chatCompletionsPath;
  } else {
    if (body.modelsPath) profile.modelsPath = body.modelsPath;
    if (body.chatCompletionsPath) profile.chatCompletionsPath = body.chatCompletionsPath;
  }
  if (body.enabled !== undefined) {
    profile.enabled = Boolean(body.enabled);
  }
  if (body.authStyle !== undefined) {
    profile.authStyle = validateAuthStyle(body.authStyle);
  }
  if (body.customHeaders !== undefined && typeof body.customHeaders === 'object') {
    profile.customHeaders = body.customHeaders;
  }
  if (body.constrainedToolCalls === true) {
    profile.constrainedToolCalls = true;
  } else if (body.constrainedToolCalls === false) {
    profile.constrainedToolCalls = false;
  } else if (body.constrainedToolCalls === null) {
    delete profile.constrainedToolCalls;
  }

  profile.updatedAt = now;
  await writeProfile(id, profile);
  return getProvider(id);
}

/**
 * @param {string} id
 */
export async function deleteProvider(id) {
  validateProviderId(id);
  const ids = await listProviderIds();
  if (ids.length <= 1) {
    throw new Error('Cannot delete the last provider');
  }
  if (!ids.includes(id)) {
    throw new Error('Provider not found');
  }

  await fs.rm(providerDir(id), { recursive: true, force: true });

  const active = await getActiveProviderId();
  if (active === id) {
    const remaining = (await listProviderIds()).sort();
    if (remaining.length > 0) {
      await setActiveProviderId(remaining[0]);
    }
  }
}

/**
 * @param {string} id
 * @param {object} body
 */
export async function updateProviderSecrets(id, body) {
  validateProviderId(id);
  await readProfile(id);
  const secrets = await readSecrets(id);

  if (body.apiKey !== undefined) {
    secrets.apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  }
  if (body.bearerToken !== undefined) {
    secrets.bearerToken = typeof body.bearerToken === 'string' ? body.bearerToken : '';
  }
  if (body.headerOverrides !== undefined && typeof body.headerOverrides === 'object') {
    secrets.headerOverrides = body.headerOverrides;
  }

  await writeSecrets(id, secrets);
  return { ok: true, ...secretsFlags(secrets) };
}

/**
 * @param {string} id
 * @returns {Promise<{ profile: object, secrets: object, headers: Record<string, string>, paths: object }>}
 */
export async function getProviderRuntime(id) {
  const profile = await readProfile(id);
  const secrets = await readSecrets(id);
  const paths = getDefaultPaths(profile.apiKind, profile);
  const caps = getProviderCapabilities(profile.apiKind);
  const supportsModelLoadUnload =
    profile.supportsModelLoadUnload !== undefined
      ? profile.supportsModelLoadUnload === true
      : caps.supportsModelLoadUnload;

  return {
    profile,
    secrets,
    headers: buildAuthHeaders(profile, secrets),
    paths,
    capabilities: { supportsModelLoadUnload },
  };
}

export { LM_STUDIO_LOCAL_ID, DEFAULT_LM_STUDIO_URL, buildAuthHeaders };
