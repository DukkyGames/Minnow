/**
 * Fire-and-forget upstream fetch that buffers into generation state.
 */

import { appendChunk, markComplete, markError, markStreaming } from './store.js';

const CHAT_TIMEOUT_MS = 120_000;

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
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

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
    const message = err instanceof Error ? err.message : String(err);
    markError(state, message);
  } finally {
    clearTimeout(timer);
  }
}
