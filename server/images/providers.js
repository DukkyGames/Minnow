/**
 * OpenAI-compatible image generation proxy.
 * POST {baseUrl}{imagesPath} with provider credentials from #12.
 */

import { getProviderRuntime } from '../providers/store.js';
import { loadImagesConfig } from './store.js';

const GENERATION_TIMEOUT_MS = 5 * 60_000;

/**
 * @typedef {object} GenerateImageInput
 * @property {string} prompt
 * @property {string} [negativePrompt]
 * @property {string} [providerId]
 * @property {string} [model]
 * @property {string} [size]
 * @property {number} [count]
 */

/**
 * @typedef {object} GeneratedImageResult
 * @property {Buffer} bytes
 * @property {string} providerId
 * @property {string} model
 * @property {Record<string, unknown>} params
 */

/**
 * @param {Response} res
 */
async function readErrorMessage(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    const err = json?.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof err.message === 'string') {
      return err.message;
    }
    return text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

/**
 * @param {string} url
 */
async function downloadImageUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to download image (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {unknown} item
 * @returns {Promise<Buffer>}
 */
async function decodeImageItem(item) {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid image payload from provider');
  }
  const row = /** @type {{ b64_json?: string, url?: string }} */ (item);
  if (typeof row.b64_json === 'string' && row.b64_json.trim()) {
    return Buffer.from(row.b64_json.trim(), 'base64');
  }
  if (typeof row.url === 'string' && row.url.trim()) {
    return downloadImageUrl(row.url.trim());
  }
  throw new Error('Provider response missing b64_json or url');
}

/**
 * Generate one or more images via an OpenAI-compatible provider.
 * @param {GenerateImageInput} input
 * @returns {Promise<GeneratedImageResult[]>}
 */
export async function generateImages(input) {
  const config = await loadImagesConfig();
  const prompt = String(input?.prompt ?? '').trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }

  const providerId = String(input?.providerId ?? config.defaultProviderId ?? '').trim();
  if (!providerId) {
    throw new Error('providerId is required — configure images.defaultProviderId in Settings');
  }

  const model = String(input?.model ?? config.defaultModel ?? 'dall-e-3').trim();
  const size = String(input?.size ?? config.defaultSize ?? '1024x1024').trim();
  const count = Math.min(4, Math.max(1, Number(input?.count ?? config.defaultCount ?? 1) || 1));

  const runtime = await getProviderRuntime(providerId);
  const { profile, headers, paths } = runtime;
  const imagesPath = paths.imagesPath || '/v1/images/generations';
  const baseUrl = String(profile.baseUrl ?? '').replace(/\/+$/, '');
  const url = `${baseUrl}${imagesPath.startsWith('/') ? '' : '/'}${imagesPath}`;

  /** @type {Record<string, unknown>} */
  const payload = {
    model,
    prompt,
    n: count,
    size,
    response_format: 'b64_json',
  };

  const negativePrompt = String(input?.negativePrompt ?? '').trim();
  if (negativePrompt) {
    payload.negative_prompt = negativePrompt;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Image generation timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    throw new Error('Rate limit exceeded — try again later');
  }
  if (res.status === 400) {
    const message = await readErrorMessage(res);
    if (/content.?policy|safety|moderation/i.test(message)) {
      throw new Error(`Content policy: ${message}`);
    }
    throw new Error(`Invalid request: ${message}`);
  }
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`Image generation failed (${res.status}): ${message}`);
  }

  const data = await res.json();
  const items = Array.isArray(data?.data) ? data.data : [];
  if (items.length === 0) {
    throw new Error('No images returned from provider');
  }

  const results = [];
  for (const item of items) {
    const bytes = await decodeImageItem(item);
    results.push({
      bytes,
      providerId,
      model,
      params: { size, count, ...(negativePrompt ? { negativePrompt } : {}) },
    });
  }
  return results;
}
