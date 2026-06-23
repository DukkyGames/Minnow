/**
 * Fire-and-forget upstream fetch that buffers into generation state.
 * Supports pre-first-token failover across configured provider/model candidates.
 */

import { readConfigJson } from '../config/store.js';
import { getProviderRuntime } from '../providers/store.js';
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
import { upstreamFetch } from './upstream-fetch.js';

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

    const url = `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`;
    const origin = originFromUrl(runtime.profile.baseUrl);
    if (isHostDead(origin)) {
      lastError = `Host in cooldown: ${origin}`;
      if (index < state.candidates.length - 1) {
        continue;
      }
      markError(state, lastError);
      return;
    }

    const requestBody = buildCandidateRequestBody(state.requestBody, candidate.modelId);
    const result = await attemptCandidateStream({
      state,
      candidate,
      index,
      url,
      headers: runtime.headers,
      requestBody,
      idleMs,
      maxMs,
      cooldownSeconds: fallbackConfig.cooldownSeconds,
      origin,
      canFailover: !state.failoverDisabled && index < state.candidates.length - 1,
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
      let detail = '';
      try {
        detail = (await upstream.text()).replace(/\s+/g, ' ').trim().slice(0, 240);
      } catch {
        /* ignore */
      }
      const html =
        detail.toLowerCase().includes('<!doctype') || detail.toLowerCase().includes('<html');
      const suffix = detail
        ? html
          ? ' (provider returned an HTML error page — check LM Studio / provider logs)'
          : `: ${detail}`
        : '';
      const message = `Upstream HTTP ${upstream.status}${suffix}`;
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
