/**
 * In-process completions for the shared runner (MIN-700 / P2-C).
 *
 * The renderer talks to generations over HTTP (`POST /api/generations` then
 * `GET …/stream`). A Node runner is already inside the same process as
 * `pumpUpstream`, so it must not take that hop — it would serialize every
 * token through a socket and leave an extra abort path to keep in sync.
 *
 * This adapter creates generation state, pumps upstream, and fans SSE bytes
 * to a callback subscriber. `persist` is always false: the journal (later
 * phases) is the record, not the generations store's 30s ephemeral cache.
 *
 * Fallback role is the agent family (`sub-agent` by default, matching
 * `tryNonStreamingFallback` in the extracted loop). Lightweight roles in
 * `NON_AGENT_FALLBACK_ROLES` (`utility`, `chat-titles`, `goal-eval`,
 * `editor-completion`) would silently pick a different model; those are
 * coerced back to `sub-agent`. The loop still passes `input.type` (e.g.
 * `turn`, `explore`) and those stay as-is — they are not non-agent roles.
 *
 * Do not import `generations/routes.js`. The HTTP path stays for the renderer.
 * Node callers import this module via `server/runner/node.js`, not `index.js`.
 */

import { validateProviderId } from '../providers/validate.js';
import { readConfigJson } from '../config/store.js';
import { listProviders } from '../providers/store.js';
import { resolveFallbackChain } from '../generations/fallback.js';
import { pumpUpstream } from '../generations/upstream.js';
import {
  addLocalSubscriber,
  cancel as cancelGeneration,
  createGenerationState,
  NON_AGENT_FALLBACK_ROLES,
  removeLocalSubscriber,
} from '../generations/store.js';

/**
 * Default fallback role when the loop does not pass one.
 * Agent work, not a utility/title/eval/completion job.
 */
export const RUNNER_FALLBACK_ROLE = 'sub-agent';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function resolveRunnerFallbackRole(raw) {
  const role = typeof raw === 'string' && raw.trim() ? raw.trim() : RUNNER_FALLBACK_ROLE;
  // A non-agent role here would route the turn onto a titles/eval model.
  if (NON_AGENT_FALLBACK_ROLES.has(role)) {
    return RUNNER_FALLBACK_ROLE;
  }
  return role;
}

/**
 * Same AbortError shape fetch-chat uses so the extracted loop's catch path
 * does not need a Node-vs-DOM branch.
 * @returns {Error}
 */
function abortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError');
  }
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * @param {unknown} terminal
 * @param {boolean} sawBytes
 */
function throwIfTerminalFailed(terminal, sawBytes) {
  const status = terminal && typeof terminal === 'object' ? terminal.status : null;
  if (status === 'error') {
    const message =
      typeof terminal.errorMessage === 'string' && terminal.errorMessage.trim()
        ? terminal.errorMessage
        : 'Generation failed';
    throw new Error(message);
  }
  if (status === 'cancelled') {
    throw abortError();
  }
  if (status === 'complete' && !sawBytes) {
    throw new Error('The provider returned an empty response.');
  }
}

/**
 * Pull-based async iterable over one generation's upstream SSE bytes.
 * Yields the same utf8 payloads `feedSseEventBuffer` already consumes.
 * The HTTP `event: end` sentinel is not yielded — terminal status is a throw
 * or a clean return, matching fetch-chat's raw subscribe.
 *
 * @param {import('../generations/store.js').GenerationState} state
 * @returns {AsyncIterable<string>}
 */
function iterateLocalSse(state) {
  /** @type {Buffer[]} */
  const queue = [];
  /** @type {{ resolve: () => void } | null} */
  let waiting = null;
  let finished = false;
  /** @type {object | null} */
  let terminal = null;

  const wake = () => {
    const waiter = waiting;
    waiting = null;
    waiter?.resolve();
  };

  const subscriber = {
    onChunk(buf) {
      queue.push(buf);
      wake();
    },
    onEnd(payload) {
      terminal = payload;
      finished = true;
      wake();
    },
  };

  addLocalSubscriber(state, subscriber);

  return {
    async *[Symbol.asyncIterator]() {
      let sawBytes = false;
      try {
        while (true) {
          while (queue.length > 0) {
            const buf = queue.shift();
            sawBytes = true;
            yield buf.toString('utf8');
          }
          if (finished) {
            throwIfTerminalFailed(terminal, sawBytes);
            return;
          }
          await new Promise((resolve) => {
            waiting = { resolve };
          });
        }
      } finally {
        removeLocalSubscriber(state, subscriber);
      }
    },
  };
}

/**
 * Create state, bind abort → `cancel(state)`, start `pumpUpstream`.
 * Subscribe before pumping so the first bytes cannot land unobserved.
 *
 * @param {string} providerId
 * @param {unknown} body
 * @param {{ signal?: AbortSignal, fallbackRole?: string | null }} [options]
 * @returns {Promise<{ state: import('../generations/store.js').GenerationState, stream: AsyncIterable<string> }>}
 */
async function startInProcessCompletion(providerId, body, options = {}) {
  const id = validateProviderId(providerId);
  const fallbackRole = resolveRunnerFallbackRole(options.fallbackRole);

  const config = (await readConfigJson('config.json')) ?? {};
  const { providers } = await listProviders();
  const enabledProviderIds = new Set(
    providers.filter((p) => p.enabled !== false).map((p) => p.id),
  );
  const bodyObj = body && typeof body === 'object' ? /** @type {{ model?: string }} */ (body) : {};
  const primaryModelId = typeof bodyObj.model === 'string' ? bodyObj.model : '';

  // Same chain helper the HTTP POST uses — do not re-implement auth/base URL.
  const candidates = resolveFallbackChain({
    role: fallbackRole,
    primaryProviderId: id,
    primaryModelId,
    config,
    enabledProviderIds,
  });

  const state = createGenerationState({
    providerId: id,
    body,
    persist: false,
    candidates,
    fallbackRole,
  });

  const signal = options.signal;
  const onAbort = () => cancelGeneration(state);
  if (signal) {
    if (signal.aborted) {
      cancelGeneration(state);
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const stream = iterateLocalSse(state);
  pumpUpstream({ state });
  return { state, stream };
}

/**
 * SSE byte stream for one completion, no HTTP hop.
 *
 * @param {string} providerId
 * @param {unknown} body
 * @param {{ signal?: AbortSignal, fallbackRole?: string | null }} [options]
 * @returns {Promise<AsyncIterable<string> & { generationId: string }>}
 */
export async function createCompletionStream(providerId, body, options = {}) {
  const started = await startInProcessCompletion(providerId, body, options);
  return Object.assign(started.stream, { generationId: started.state.id });
}

/**
 * Server-default `PostChatCompletions`. Synthetic Response whose body replays
 * the in-process SSE stream so `runTurn` / `createSubAgentRunner` need no
 * loop change. The renderer adapter keeps HTTP `/api/generations`.
 *
 * @type {import('./adapters').PostChatCompletions}
 */
export async function postChatCompletionsInProcess(provider, body, signal, options = {}) {
  const providerId = provider?.id;
  if (typeof providerId !== 'string' || !providerId.trim()) {
    throw new Error('postChatCompletionsInProcess: provider.id is required');
  }

  const started = await startInProcessCompletion(providerId, body, {
    signal,
    fallbackRole: options?.fallbackRole,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const payload of started.stream) {
          controller.enqueue(encoder.encode(payload));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      // Reader cancel (thinking-budget trip, drop) must stop upstream too.
      cancelGeneration(started.state);
    },
  });

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
