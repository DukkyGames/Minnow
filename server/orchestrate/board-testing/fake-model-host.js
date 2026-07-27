/**
 * In-process singleton for the orchestrate fake model HTTP server.
 */

import {
  createFakeModelServer,
  FAKE_MODEL_ID,
  FAKE_PROVIDER_ID,
} from '../../../scripts/fake-model-server.mjs';
import { createProvider, listProviders, updateProvider } from '../../providers/store.js';

/** @type {{ fake: ReturnType<typeof createFakeModelServer>; port: number; baseUrl: string } | null} */
let active = null;

/**
 * @param {string} baseUrl
 */
async function registerFakeProvider(baseUrl) {
  const body = {
    id: FAKE_PROVIDER_ID,
    label: 'Fake board model',
    baseUrl,
    apiKind: 'openai-v1',
  };
  const { providers } = await listProviders();
  if (providers.some((p) => p.id === FAKE_PROVIDER_ID)) {
    await updateProvider(FAKE_PROVIDER_ID, body);
    return;
  }
  await createProvider(body);
}

/** @returns {{ running: boolean; port: number | null; baseUrl: string | null; requestCount: number; modelId: string; providerId: string }} */
export function getFakeModelStatus() {
  if (!active) {
    return {
      running: false,
      port: null,
      baseUrl: null,
      requestCount: 0,
      modelId: FAKE_MODEL_ID,
      providerId: FAKE_PROVIDER_ID,
    };
  }
  return {
    running: true,
    port: active.port,
    baseUrl: active.baseUrl,
    requestCount: active.fake.requests.length,
    modelId: FAKE_MODEL_ID,
    providerId: FAKE_PROVIDER_ID,
  };
}

/** Default listen port for the in-process fake model host. */
const DEFAULT_PORT = 18765;

/**
 * @param {{ port?: number }} [options]
 */
export async function startFakeModel(options = {}) {
  if (active) {
    await stopFakeModel();
  }

  const fake = createFakeModelServer();
  const port = options.port ?? DEFAULT_PORT;
  const resolvedPort = await fake.listen(port);
  const baseUrl = `http://127.0.0.1:${resolvedPort}`;
  await registerFakeProvider(baseUrl);
  active = { fake, port: resolvedPort, baseUrl };
  return getFakeModelStatus();
}

export async function stopFakeModel() {
  if (!active) {
    return getFakeModelStatus();
  }
  await active.fake.close();
  active = null;
  return getFakeModelStatus();
}
