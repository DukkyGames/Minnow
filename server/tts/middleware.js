/**
 * TTS API — provider-backed text-to-speech proxy with optional cache.
 */

import { getProviderRuntime } from '../providers/store.js';
import { loadVoiceConfig, resolveVoicePaths } from '../voice/config.js';
import {
  getCachedSynthesis,
  putCachedSynthesis,
  readTtsCache,
} from './cache.js';

const MAX_TTS_TEXT_CHARS = 4096;

/** OpenAI TTS speed bounds. */
const MIN_TTS_SPEED = 0.25;
const MAX_TTS_SPEED = 4.0;

/** CORS headers for dev SPA. */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 32_768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Clamp and validate TTS playback speed.
 * @param {unknown} value
 * @param {number} fallback
 */
export function normalizeTtsSpeed(value, fallback = 1) {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(MAX_TTS_SPEED, Math.max(MIN_TTS_SPEED, num));
}

/**
 * Map response format to MIME type.
 * @param {string} format
 */
function mimeForFormat(format) {
  if (format === 'wav') return 'audio/wav';
  if (format === 'opus') return 'audio/opus';
  return 'audio/mpeg';
}

/**
 * Build TTS status for the client.
 * @param {Awaited<ReturnType<typeof loadVoiceConfig>>} voice
 */
async function buildTtsStatus(voice) {
  const tts = voice.tts;
  const enabled = tts.enabled === true;
  const providerId = String(tts.providerId || '').trim();
  const browser = providerId === 'browser';
  let healthy = browser;
  if (enabled && providerId && !browser) {
    try {
      await getProviderRuntime(providerId);
      healthy = true;
    } catch {
      healthy = false;
    }
  }
  return {
    enabled,
    providerId,
    model: tts.model,
    voice: tts.voice,
    speed: tts.speed,
    format: tts.format,
    browser,
    healthy,
  };
}

/**
 * Synthesize speech via provider API.
 * @param {object} params
 */
async function synthesizeWithProvider(params) {
  const { providerId, model, voice, speed, format, text } = params;
  const runtime = await getProviderRuntime(providerId);
  const paths = resolveVoicePaths(runtime.paths);
  const url = `${runtime.profile.baseUrl}${paths.speechPath}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/*',
        ...runtime.headers,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        speed,
        response_format: format,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(detail || `Provider returned ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Handle /api/tts/* routes.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 */
export async function handleTtsRequest(req, res, pathname) {
  if (pathname === '/api/tts/status' && req.method === 'GET') {
    const voice = await loadVoiceConfig();
    const status = await buildTtsStatus(voice);
    sendJson(res, 200, status);
    return true;
  }

  if (pathname === '/api/tts/synthesize' && req.method === 'POST') {
    const voice = await loadVoiceConfig();
    const tts = voice.tts;
    if (!tts.enabled) {
      sendJson(res, 503, { error: 'Text-to-speech is disabled in settings' });
      return true;
    }
    const providerId = String(tts.providerId || '').trim();
    if (!providerId || providerId === 'browser') {
      sendJson(res, 503, {
        error: 'Browser TTS runs client-side. Configure a provider in Settings → Voice.',
      });
      return true;
    }

    try {
      const body = await readJsonBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        sendJson(res, 400, { error: 'text is required' });
        return true;
      }
      if (text.length > MAX_TTS_TEXT_CHARS) {
        sendJson(res, 400, {
          error: `text exceeds ${MAX_TTS_TEXT_CHARS} character limit`,
        });
        return true;
      }

      const selectedVoice =
        typeof body.voice === 'string' && body.voice.trim()
          ? body.voice.trim()
          : tts.voice;
      const speed = normalizeTtsSpeed(
        body.speed ?? tts.speed,
        normalizeTtsSpeed(tts.speed, 1),
      );
      const format =
        typeof body.format === 'string' && body.format.trim()
          ? body.format.trim()
          : tts.format;

      const cached = await getCachedSynthesis(text, selectedVoice, speed, format);
      if (cached) {
        sendJson(res, 200, { url: `/api/tts/audio/${cached.id}` });
        return true;
      }

      const audio = await synthesizeWithProvider({
        providerId,
        model: tts.model,
        voice: selectedVoice,
        speed,
        format,
        text,
      });
      const mime = mimeForFormat(format);
      const id = await putCachedSynthesis(
        text,
        selectedVoice,
        speed,
        format,
        audio,
        mime,
      );

      const returnBytes = body.returnBytes === true;
      if (returnBytes) {
        res.statusCode = 200;
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', String(audio.length));
        res.end(audio);
        return true;
      }

      sendJson(res, 200, { url: `/api/tts/audio/${id}` });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: `Synthesis failed: ${message}` });
      return true;
    }
  }

  const audioPrefix = '/api/tts/audio/';
  if (pathname.startsWith(audioPrefix) && req.method === 'GET') {
    const id = decodeURIComponent(pathname.slice(audioPrefix.length)).replace(
      /\.[a-z0-9]+$/i,
      '',
    );
    if (!/^[a-f0-9]{64}$/.test(id)) {
      sendJson(res, 400, { error: 'Invalid cache id' });
      return true;
    }
    const cached = await readTtsCache(id);
    if (!cached) {
      sendJson(res, 404, { error: 'Audio not found or expired' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', cached.mime);
    res.setHeader('Content-Length', String(cached.data.length));
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.end(cached.data);
    return true;
  }

  return false;
}

export function createTtsMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/tts')) {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const handled = await handleTtsRequest(req, res, url);
    if (!handled) {
      sendJson(res, 404, { error: 'Not found' });
    }
  };
}

/** @internal Test helpers */
export { buildTtsStatus, synthesizeWithProvider, MAX_TTS_TEXT_CHARS };
