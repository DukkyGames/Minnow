/**
 * Proxy upstream models (and load/unload) with server-side auth injection.
 */

import { getProviderRuntime } from './store.js';
import { normalizeModelsResponse, enrichLmStudioModelsWithV1Reasoning } from './paths.js';
import {
  enrichOpenCodeModelsFromModelsDev,
  isOpenCodeProviderBaseUrl,
} from './models-dev-context.js';
import { normalizeOpenCodeZenRelativePath } from './opencode-zen.js';
import { validateProviderId } from './validate.js';
import { resolveModelApi } from '../generations/resolve-model-api.js';

const MODELS_TIMEOUT_MS = 15_000;
const MODEL_LOAD_TIMEOUT_MS = 120_000;
const MODEL_UNLOAD_TIMEOUT_MS = 60_000;

/**
 * @param {string} id
 */
export async function proxyModels(id) {
  validateProviderId(id);
  const { profile, headers, paths } = await getProviderRuntime(id);
  const modelsPath = normalizeOpenCodeZenRelativePath(profile.baseUrl, paths.modelsPath);
  const url = `${profile.baseUrl}${modelsPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upstream models HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    let normalized = normalizeModelsResponse(profile.apiKind, json);
    if (profile.apiKind === 'lm-studio-v0') {
      normalized = await enrichLmStudioModelsWithV1Reasoning(
        profile.baseUrl,
        headers,
        normalized,
      );
    }
    if (isOpenCodeProviderBaseUrl(profile.baseUrl)) {
      normalized = await enrichOpenCodeModelsFromModelsDev(normalized);
    }
    normalized = {
      data: normalized.data.map((row) => ({
        ...row,
        api: resolveModelApi({ profile }, row.id, row),
      })),
    };
    return normalized;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} id
 * @param {object} body
 */
export async function proxyModelLoad(id, body) {
  validateProviderId(id);
  const runtime = await getProviderRuntime(id);
  if (!runtime.capabilities.supportsModelLoadUnload) {
    throw new Error('Provider does not support model load/unload');
  }
  const loadPath = runtime.paths.modelsLoadPath;
  if (!loadPath) {
    throw new Error('Provider does not support model load/unload');
  }

  const url = `${runtime.profile.baseUrl}${loadPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LOAD_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...runtime.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upstream load HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} id
 * @param {object} body
 */
export async function proxyModelUnload(id, body) {
  validateProviderId(id);
  const runtime = await getProviderRuntime(id);
  if (!runtime.capabilities.supportsModelLoadUnload) {
    throw new Error('Provider does not support model load/unload');
  }
  const unloadPath = runtime.paths.modelsUnloadPath;
  if (!unloadPath) {
    throw new Error('Provider does not support model load/unload');
  }

  const url = `${runtime.profile.baseUrl}${unloadPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_UNLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...runtime.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upstream unload HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
