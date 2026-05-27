/**
 * Fire-and-forget upstream fetch that buffers into generation state.
 */

import { appendChunk, markComplete, markError, markStreaming } from './store.js';

/** Abort when no upstream bytes arrive for this long (slow models may pause between tokens). */
const UPSTREAM_IDLE_TIMEOUT_MS = 500_000;
/** Hard cap on wall-clock generation time regardless of stream activity. */
const UPSTREAM_MAX_DURATION_MS = 60 * 60_000;

/**
 * @param {'idle' | 'max'} kind
 * @returns {string}
 */
function upstreamTimeoutMessage(kind) {
  if (kind === 'idle') {
    const min = Math.round(UPSTREAM_IDLE_TIMEOUT_MS / 60_000);
    return `The model stopped sending data for ${min} minutes. Try again, shorten context, or use a faster model.`;
  }
  const min = Math.round(UPSTREAM_MAX_DURATION_MS / 60_000);
  return `Generation reached the ${min}-minute server limit. Try again with a shorter prompt or smaller max tokens.`;
}

/**
 * Start pumping an upstream chat/completions response into state chunks.
 * Not awaited by route handlers — errors are handled inside the promise chain.
 *
 * @param {{ state: import('./store.js').GenerationState, url: string, headers: Record<string, string> }} params
 */
export function pumpUpstream({ state, url, headers }) {
  void pumpUpstreamAsync({ state, url, headers }).catch((err) => {
    console.error('[generations] unhandled pump error:', err);
  });
}

/**
 * @param {{ state: import('./store.js').GenerationState, url: string, headers: Record<string, string> }} params
 */
async function pumpUpstreamAsync({ state, url, headers }) {
  const controller = new AbortController();
  state.upstreamController = controller;

  /** @type {'idle' | 'max' | null} */
  let timeoutKind = null;
  let idleTimer = null;

  const armIdleTimeout = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutKind = 'idle';
      controller.abort();
    }, UPSTREAM_IDLE_TIMEOUT_MS);
  };

  const maxTimer = setTimeout(() => {
    timeoutKind = 'max';
    controller.abort();
  }, UPSTREAM_MAX_DURATION_MS);

  armIdleTimeout();

  try {
    markStreaming(state);

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        ...headers,
      },
      body: state.requestBody,
      signal: controller.signal,
    });

    if (!upstream.ok) {
      let detail = '';
      try {
        detail = (await upstream.text()).replace(/\s+/g, ' ').trim().slice(0, 240);
      } catch {
        /* ignore */
      }
      const html = detail.toLowerCase().includes('<!doctype') || detail.toLowerCase().includes('<html');
      const suffix = detail
        ? html
          ? ' (provider returned an HTML error page — check LM Studio / provider logs)'
          : `: ${detail}`
        : '';
      markError(state, `Upstream HTTP ${upstream.status}${suffix}`);
      return;
    }

    if (!upstream.body) {
      const text = await upstream.text();
      if (text) {
        appendChunk(state, Buffer.from(text, 'utf8'));
      }
      if (state.status !== 'error' && state.status !== 'cancelled') {
        markComplete(state);
      }
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdleTimeout();
      appendChunk(state, Buffer.from(value));
      if (state.status === 'error' || state.status === 'cancelled') {
        return;
      }
    }

    if (state.status !== 'error' && state.status !== 'cancelled') {
      markComplete(state);
    }
  } catch (err) {
    if (state.status === 'cancelled') {
      return;
    }
    if (timeoutKind) {
      markError(state, upstreamTimeoutMessage(timeoutKind));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    markError(state, message);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(maxTimer);
  }
}
