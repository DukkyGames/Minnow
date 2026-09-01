/**
 * Injected I/O for the shared runner.
 *
 * Completions: server default is `postChatCompletionsInProcess` in
 * `generation-binding.js` (generations store, no HTTP hop). This file's
 * `postChatCompletionsHttp` remains for tests that POST a fake host directly.
 * The renderer (`src/agents/renderer-runner-deps.ts`) keeps HTTP
 * `/api/generations` via `src/providers/fetch-chat.ts`.
 * Server default for tools is `createInProcessToolDispatch` in
 * `tool-dispatch.js` (same registry as POST `/api/tools`, no HTTP hop).
 * The renderer adapter keeps `src/tools/headless-tool-batch.ts`.
 */

/**
 * Direct HTTP POST to an OpenAI-compatible `/v1/chat/completions`.
 * Used by Node tests against the fake model host; the renderer default remains
 * `src/providers/fetch-chat.ts` (`/api/generations`).
 *
 * @param {{ baseUrl?: string, chatCompletionsPath?: string, apiKey?: string }} provider
 * @param {Record<string, unknown>} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<Response>}
 */
export async function postChatCompletionsHttp(provider, body, signal) {
  const base = String(provider?.baseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('postChatCompletionsHttp: provider.baseUrl is required');
  const path = provider.chatCompletionsPath || '/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * No-op tool dispatch for turns that do not call tools.
 * Server callers use `createInProcessToolDispatch` instead.
 * @param {{ toolCalls?: unknown[] }} [options]
 * @returns {Promise<never[]>}
 */
export async function runHeadlessToolBatchStub(options = {}) {
  void options;
  return [];
}
