/**
 * STT API — provider-backed speech-to-text proxy.
 */

import { getProviderRuntime } from '../providers/store.js';
import { loadVoiceConfig, resolveVoicePaths } from '../voice/config.js';
import { formatByteLimit, isAllowedAudioMime, resolveSttLimits } from './limits.js';
import { parseMultipartFile } from './multipart.js';

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

/**
 * Build STT status payload for the client.
 * @param {Awaited<ReturnType<typeof loadVoiceConfig>>} voice
 */
async function buildSttStatus(voice) {
  const stt = voice.stt;
  const enabled = stt.enabled === true;
  const providerId = String(stt.providerId || '').trim();
  let healthy = false;
  if (enabled && providerId) {
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
    model: stt.model,
    language: stt.language,
    healthy,
  };
}

/**
 * Forward audio bytes to the provider transcription endpoint.
 * @param {object} params
 */
async function transcribeWithProvider(params) {
  const { providerId, model, language, audioBuffer, mime, filename } = params;
  const runtime = await getProviderRuntime(providerId);
  const paths = resolveVoicePaths(runtime.paths);
  const url = `${runtime.profile.baseUrl}${paths.transcriptionsPath}`;

  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mime });
  form.append('file', blob, filename || 'audio.webm');
  form.append('model', model);
  if (language) {
    form.append('language', language);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...runtime.headers,
      },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(detail || `Provider returned ${res.status}`);
    }
    const json = await res.json();
    const text = typeof json.text === 'string' ? json.text.trim() : '';
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Handle /api/stt/* routes.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 */
export async function handleSttRequest(req, res, pathname) {
  if (pathname === '/api/stt/status' && req.method === 'GET') {
    const voice = await loadVoiceConfig();
    const status = await buildSttStatus(voice);
    sendJson(res, 200, status);
    return true;
  }

  if (pathname === '/api/stt/transcribe' && req.method === 'POST') {
    const voice = await loadVoiceConfig();
    const stt = voice.stt;
    if (!stt.enabled) {
      sendJson(res, 503, { error: 'Speech-to-text is disabled in settings' });
      return true;
    }
    const providerId = String(stt.providerId || '').trim();
    if (!providerId) {
      sendJson(res, 503, {
        error: 'No STT provider configured. Open Settings → Voice.',
      });
      return true;
    }

    const { maxAudioBytes } = resolveSttLimits(voice);
    try {
      const upload = await parseMultipartFile(req, maxAudioBytes);
      if (!upload.buffer.length) {
        sendJson(res, 400, { error: 'Empty audio file' });
        return true;
      }
      if (!isAllowedAudioMime(upload.mime)) {
        sendJson(res, 415, {
          error: `Unsupported audio type: ${upload.mime || 'unknown'}`,
        });
        return true;
      }

      const text = await transcribeWithProvider({
        providerId,
        model: stt.model,
        language: stt.language,
        audioBuffer: upload.buffer,
        mime: upload.mime,
        filename: upload.filename,
      });
      sendJson(res, 200, { text });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('exceeds')) {
        sendJson(res, 413, { error: message });
        return true;
      }
      if (message.includes('Unsupported') || message.includes('multipart')) {
        sendJson(res, 400, { error: message });
        return true;
      }
      sendJson(res, 500, { error: `Transcription failed: ${message}` });
      return true;
    }
  }

  return false;
}

export function createSttMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/stt')) {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const handled = await handleSttRequest(req, res, url);
    if (!handled) {
      sendJson(res, 404, { error: 'Not found' });
    }
  };
}

/** @internal Test helper */
export { buildSttStatus, transcribeWithProvider, formatByteLimit };
