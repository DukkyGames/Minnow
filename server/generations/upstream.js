/**
 * Fire-and-forget upstream fetch that buffers into generation state.
 * Supports pre-first-token failover across configured provider/model candidates.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfigJson } from '../config/store.js';
import { getProviderRuntime } from '../providers/store.js';
import {
  resolveOpenCodeZenUpstreamUrl,
} from '../providers/opencode-zen.js';
import { sanitizeCompletionBodyForProvider } from '../providers/sanitize-completion-body.js';
import {
  buildCandidateRequestBody,
  classifyUpstreamError,
  readFallbackChainsConfig,
} from './fallback.js';
import { isHostDead, markHostDead, originFromUrl } from './host-cooldown.js';
import {
  appendChunk,
  markComplete,
  markError,
  markStreaming,
  noteGenerationCandidateChosen,
} from './store.js';
import {
  generationTimeoutMessage,
  readGenerationUpstreamTimeouts,
} from './timeouts.js';
import { pumpAnthropicUpstream } from './anthropic/pump.js';
import { formatUpstreamHttpErrorMessage } from './upstream-error-detail.js';
import { upstreamFetch } from './upstream-fetch.js';

/**
 * Best-effort diagnostic dump of the outbound body + upstream error body when an
 * openai-v1 upstream POST fails, mirroring the anthropic gateway dump so opaque
 * "Upstream request failed" 400s can be root-caused from the last occurrence.
 * @param {{ status: number, url: string, providerId: string, modelId: string, requestBody: Buffer, responseText: string }} info
 */
function dumpUpstreamFailure(info) {
  try {
    const dir = join(homedir(), '.minnow', 'debug');
    mkdirSync(dir, { recursive: true });
    let parsedBody;
    try {
      parsedBody = JSON.parse(info.requestBody.toString('utf8'));
    } catch {
      parsedBody = info.requestBody.toString('utf8');
    }
    writeFileSync(
      join(dir, 'openai-upstream-last-error.json'),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          status: info.status,
          url: info.url,
          providerId: info.providerId,
          modelId: info.modelId,
          responseText: info.responseText,
          requestBody: parsedBody,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    // Best-effort diagnostic only.
  }
}

/**
 * Kimi (Moonshot AI) thinking/code models only accept temperature=1.
 * OpenAI-v1 bodies are sanitized (sampler + reasoning fields) before upstream POST.
 * @param {Buffer} requestBody
 * @param {{ apiKind?: string, baseUrl?: string }} profile
 * @param {string} modelId
 * @returns {Buffer}
 */
function prepareUpstreamRequestBody(requestBody, profile, modelId) {
  const apiKind = profile.apiKind ?? 'openai-v1';
  let body = requestBody;

  try {
    const parsed = JSON.parse(requestBody.toString('utf8'));
    if (parsed && typeof parsed === 'object') {
      const sanitized = sanitizeCompletionBodyForProvider(
        /** @type {Record<string, unknown>} */ (parsed),
        { apiKind },
      );
      body = Buffer.from(JSON.stringify(sanitized), 'utf8');
    }
  } catch {
    /* keep raw body */
  }

  if (apiKind !== 'openai-v1') return body;

  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return body;
    const model = typeof parsed.model === 'string' ? parsed.model : modelId;
    if (!/kimi/i.test(model)) return body;
    if (typeof parsed.temperature !== 'number' || parsed.temperature === 1) return body;
    return Buffer.from(JSON.stringify({ ...parsed, temperature: 1 }), 'utf8');
  } catch {
    return body;
  }
}

/**
 * Start pumping an upstream chat/completions response into state chunks.
 * Not awaited by route handlers — errors are handled inside the promise chain.
 *
 * @param {{ state: import('./store.js').GenerationState }} params
 */
export function pumpUpstream({ state }) {
  void pumpUpstreamAsync({ state }).catch((err) => {
    console.error('[generations] unhandled pump error:', err);
  });
}

/**
 * @param {{ state: import('./store.js').GenerationState }} params
 */
async function pumpUpstreamAsync({ state }) {
  const config = (await readConfigJson('config.json')) ?? {};
  const fallbackConfig = readFallbackChainsConfig(config);
  const { idleMs, maxMs } = await readGenerationUpstreamTimeouts();

  /** @type {string | null} */
  let lastError = null;

  for (let index = state.activeCandidateIndex; index < state.candidates.length; index += 1) {
    if (state.status === 'cancelled') {
      return;
    }
    if (state.failoverDisabled && index > state.activeCandidateIndex) {
      return;
    }

    const candidate = state.candidates[index];
    let runtime;
    try {
      runtime = await getProviderRuntime(candidate.providerId);
    } catch (err) {
      const classified = classifyUpstreamError(err);
      lastError = classified.reason;
      if (classified.kind === 'retryable' && index < state.candidates.length - 1) {
        continue;
      }
      markError(state, lastError);
      return;
    }

    if (runtime.profile.enabled === false) {
      lastError = `Provider disabled: ${candidate.providerId}`;
      if (index < state.candidates.length - 1) {
        continue;
      }
      markError(state, lastError);
      return;
    }

    const url = resolveOpenCodeZenUpstreamUrl(
      runtime.profile.baseUrl,
      runtime.paths.chatCompletionsPath,
    );
    const origin = originFromUrl(runtime.profile.baseUrl);
    if (isHostDead(origin)) {
      lastError = `Host in cooldown: ${origin}`;
      if (index < state.candidates.length - 1) {
        continue;
      }
      markError(state, lastError);
      return;
    }

    const canFailover = !state.failoverDisabled && index < state.candidates.length - 1;
    const result =
      runtime.profile.apiKind === 'anthropic-v1'
        ? await pumpAnthropicUpstream({
            state,
            runtime,
            candidate,
            index,
            idleMs,
            maxMs,
            cooldownSeconds: fallbackConfig.cooldownSeconds,
            canFailover,
          })
        : await attemptCandidateStream({
            state,
            candidate,
            index,
            url,
            headers: runtime.headers,
            requestBody: prepareUpstreamRequestBody(
              buildCandidateRequestBody(state.requestBody, candidate.modelId),
              runtime.profile,
              candidate.modelId,
            ),
            idleMs,
            maxMs,
            cooldownSeconds: fallbackConfig.cooldownSeconds,
            origin,
            canFailover,
          });

    if (result.outcome === 'complete') {
      return;
    }
    if (result.outcome === 'fatal') {
      markError(state, result.message ?? 'Generation failed');
      return;
    }
    lastError = result.message ?? lastError;
  }

  markError(state, lastError ?? 'All fallback candidates failed');
}

/**
 * @param {{
 *   state: import('./store.js').GenerationState,
 *   candidate: { providerId: string, modelId: string },
 *   index: number,
 *   url: string,
 *   headers: Record<string, string>,
 *   requestBody: Buffer,
 *   idleMs: number,
 *   maxMs: number,
 *   cooldownSeconds: number,
 *   origin: string,
 *   canFailover: boolean,
 * }} params
 * @returns {Promise<{ outcome: 'complete' | 'retry' | 'fatal', message?: string }>}
 */
async function attemptCandidateStream({
  state,
  candidate,
  index,
  url,
  headers,
  requestBody,
  idleMs,
  maxMs,
  cooldownSeconds,
  origin,
  canFailover,
}) {
  const controller = new AbortController();
  state.upstreamController = controller;

  /** @type {'idle' | 'max' | null} */
  let timeoutKind = null;
  let idleTimer = null;
  let bytesEmitted = false;

  const armIdleTimeout = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutKind = 'idle';
      controller.abort();
    }, idleMs);
  };

  const maxTimer = setTimeout(() => {
    timeoutKind = 'max';
    controller.abort();
  }, maxMs);

  armIdleTimeout();

  try {
    markStreaming(state);

    const upstream = await upstreamFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        ...headers,
      },
      body: requestBody,
      signal: controller.signal,
    });

    if (!upstream.ok) {
      let rawBody = '';
      try {
        rawBody = await upstream.text();
      } catch {
        /* ignore */
      }
      const message = formatUpstreamHttpErrorMessage(upstream.status, rawBody);
      dumpUpstreamFailure({
        status: upstream.status,
        url,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        requestBody,
        responseText: rawBody,
      });
      const classified = classifyUpstreamError(null, upstream);
      if (!bytesEmitted && classified.kind === 'retryable' && canFailover) {
        if (upstream.status >= 500 || [502, 503, 504].includes(upstream.status)) {
          markHostDead(origin, cooldownSeconds);
        }
        return { outcome: 'retry', message };
      }
      return { outcome: 'fatal', message };
    }

    if (!upstream.body) {
      const text = await upstream.text();
      if (text) {
        bytesEmitted = true;
        noteGenerationCandidateChosen(state, {
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          index,
        });
        appendChunk(state, Buffer.from(text, 'utf8'));
      }
      if (state.status !== 'error' && state.status !== 'cancelled') {
        markComplete(state);
      }
      return { outcome: 'complete' };
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdleTimeout();
      if (!bytesEmitted) {
        bytesEmitted = true;
        noteGenerationCandidateChosen(state, {
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          index,
        });
      }
      appendChunk(state, Buffer.from(value));
      if (state.status === 'error' || state.status === 'cancelled') {
        return { outcome: 'complete' };
      }
    }

    if (state.status !== 'error' && state.status !== 'cancelled') {
      markComplete(state);
    }
    return { outcome: 'complete' };
  } catch (err) {
    if (state.status === 'cancelled') {
      return { outcome: 'complete' };
    }
    if (timeoutKind) {
      const message = generationTimeoutMessage({ idleMs, maxMs }, timeoutKind);
      if (!bytesEmitted && canFailover) {
        markHostDead(origin, cooldownSeconds);
        return { outcome: 'retry', message };
      }
      return { outcome: 'fatal', message };
    }
    const classified = classifyUpstreamError(err);
    if (!bytesEmitted && classified.kind === 'retryable' && canFailover) {
      markHostDead(origin, cooldownSeconds);
      return { outcome: 'retry', message: classified.reason };
    }
    return { outcome: 'fatal', message: classified.reason };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    if (state.upstreamController === controller) {
      state.upstreamController = null;
    }
  }
}
