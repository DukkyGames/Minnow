/**
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
 * @param {{ toolCalls?: unknown[] }} [options]
 * @returns {Promise<never[]>}
 */
export async function runHeadlessToolBatchStub(options = {}) {
  void options;
  return [];
}
