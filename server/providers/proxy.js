/**
 * Proxy upstream models + chat/completions with server-side auth injection.
 */

import { getProviderRuntime } from './store.js';
import { normalizeModelsResponse } from './paths.js';
import { validateProviderId } from './validate.js';

const MODELS_TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 120_000;

/**
 * @param {string} id
 */
export async function proxyModels(id) {
  validateProviderId(id);
  const { profile, headers, paths } = await getProviderRuntime(id);
  const url = `${profile.baseUrl}${paths.modelsPath}`;
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
    return normalizeModelsResponse(profile.apiKind, json);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} id
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function proxyChatCompletions(id, req, res) {
  validateProviderId(id);
  const { profile, headers, paths } = await getProviderRuntime(id);
  const url = `${profile.baseUrl}${paths.chatCompletionsPath}`;

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (c) => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const body = Buffer.concat(chunks);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      ...headers,
    },
    body,
    signal: controller.signal,
  });

  clearTimeout(timer);

  res.statusCode = upstream.status;
  const contentType = upstream.headers.get('content-type');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }

  if (!upstream.body) {
    const text = await upstream.text();
    res.end(text);
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.end(JSON.stringify({ error: message }));
    return;
  }

  res.end();
}
