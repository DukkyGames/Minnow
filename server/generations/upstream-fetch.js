/**
 * Upstream LLM fetch with undici timeouts disabled.
 *
 * Node's built-in fetch (undici) defaults to a 300s body idle timeout between
 * chunks. LM Studio and other local providers can pause longer than that during
 * reasoning or slow token generation. Minnow enforces its own idle/max limits
 * in upstream.js via AbortController — undici must not cut the stream early.
 */

import { Agent } from 'undici';

/** Shared dispatcher for all generation upstream requests. */
const upstreamAgent = new Agent({
  bodyTimeout: 0,
  headersTimeout: 0,
  connectTimeout: 60_000,
});

/**
 * Fetch helper for provider chat/completions streams.
 *
 * @param {string | URL} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
export function upstreamFetch(url, init = {}) {
  return fetch(url, { ...init, dispatcher: upstreamAgent });
}

/** @internal Test hook — verify undici is not enforcing short body timeouts. */
export function getUpstreamAgentForTests() {
  return upstreamAgent;
}
