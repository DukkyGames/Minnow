/**
 * Live runtime activity for running llama.cpp serves, polled from `/slots`.
 *
 * Polled server-side rather than derived from Minnow's own chat stream so the panels
 * tell the truth about *all* traffic — an agent loop, a headless run, or a `curl` from
 * outside Minnow shows up the same way a chat message does.
 *
 * What `/slots` actually carries (measured on b9628, not assumed):
 *
 * - idle slots return only `{id, n_ctx, speculative, is_processing}`;
 * - a busy slot adds `id_task`, `n_prompt_tokens`, `n_prompt_tokens_processed`,
 *   `n_prompt_tokens_cache`, the resolved sampler `params`, and `next_token`;
 * - during prefill `n_prompt_tokens` *mirrors* `n_prompt_tokens_processed` — both climb
 *   in `n_batch` steps — so **there is no denominator and no prefill percentage here**.
 *   Prefill is reported as a token count. A real percentage exists only in the chat
 *   stream, via the `return_progress` request field;
 * - `next_token[0].n_decoded` holds the *previous* task's final count during prefill,
 *   so it is only trusted once `n_remain > 0`, and is reset when `id_task` changes;
 * - there is no tok/s field; it is derived here from Δdecoded over Δt;
 * - a saturated server stops answering `/slots` entirely. A timeout is `stale`, never
 *   `idle` — reporting Ready for a server that is pinned at 100% would be a lie.
 */

/** Poll cadence while at least one slot is working. */
const BUSY_INTERVAL_MS = 400;
/** Poll cadence when everything is idle. */
const IDLE_INTERVAL_MS = 2_500;
/** A slow `/slots` is a busy server, not a dead one — give up on the request, not the poll. */
const REQUEST_TIMEOUT_MS = 1_500;
/** Samples older than this are reported as stale rather than current. */
const STALE_AFTER_MS = 10_000;

/**
 * @typedef {object} ServeActivitySlot
 * @property {number} id
 * @property {number | null} taskId
 * @property {'idle' | 'prompt' | 'generating'} state
 * @property {number} promptProcessed Prompt tokens fed so far. A count, not a fraction.
 * @property {number} promptCached Prefix reused from the prompt cache.
 * @property {number} decoded Tokens generated for the current task.
 * @property {number | null} remaining Tokens still allowed for the current task.
 * @property {number | null} tokensPerSecond Derived from consecutive samples.
 */

/**
 * @typedef {object} ServeActivity
 * @property {string} serveId
 * @property {string} modelLabel Identity for surfaces that never hold a serve list.
 * @property {string | null} libraryId Library row id, when the serve was started from one.
 * @property {number} updatedAt
 * @property {boolean} available `/slots` answered at least once.
 * @property {boolean} stale The last sample is too old to trust.
 * @property {number} queued llama.cpp deferred requests (`requests_deferred` from `/metrics`).
 * @property {ServeActivitySlot[]} slots
 */

/** @type {Map<string, { timer: NodeJS.Timeout | null, stopped: boolean, last: ServeActivity | null, prev: Map<number, { taskId: number | null, decoded: number, at: number }> }>} */
const pollers = new Map();

/** @type {Set<(activity: ServeActivity) => void>} */
const listeners = new Set();

/** @type {typeof fetch} */
let fetchImpl = (...args) => fetch(...args);

/** Test seam — swap the transport without standing up an HTTP server. */
export function setServeActivityFetchForTests(fn) {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

export function resetServeActivityFetchForTests() {
  fetchImpl = (...args) => fetch(...args);
}

/**
 * Subscribe to activity samples for every polled serve.
 * @param {(activity: ServeActivity) => void} listener
 * @returns {() => void}
 */
export function subscribeServeActivity(listener) {
  listeners.add(listener);
  // Replay what we already know so a late subscriber is not blank until the next tick.
  for (const entry of pollers.values()) {
    if (entry.last) {
      try {
        listener(entry.last);
      } catch {
        /* a broken listener must not stop the others */
      }
    }
  }
  return () => listeners.delete(listener);
}

/** @param {ServeActivity} activity */
function publish(activity) {
  for (const listener of listeners) {
    try {
      listener(activity);
    } catch {
      /* one bad consumer must not kill the poll loop */
    }
  }
}

/** @param {unknown} value */
function asInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Turn one `/slots` response into the DTO, using the previous sample for rates.
 * Exported for tests — this is where every quirk in the endpoint is absorbed.
 *
 * @param {unknown} raw Parsed `/slots` body.
 * @param {Map<number, { taskId: number | null, decoded: number, at: number }>} prev
 * @param {number} now
 * @returns {ServeActivitySlot[]}
 */
export function normalizeSlots(raw, prev, now) {
  if (!Array.isArray(raw)) return [];
  /** @type {ServeActivitySlot[]} */
  const slots = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = asInt(entry.id);
    const busy = entry.is_processing === true;
    const taskId = entry.id_task == null ? null : asInt(entry.id_task);
    const nextToken = Array.isArray(entry.next_token) ? entry.next_token[0] : null;
    const remaining = nextToken && nextToken.n_remain != null ? asInt(nextToken.n_remain) : null;

    // n_decoded is left over from the previous task while a new prompt is prefilling.
    // Trust it only once the task has tokens left to produce.
    const generating = busy && remaining != null && remaining > 0;
    const decoded = generating && nextToken ? asInt(nextToken.n_decoded) : 0;

    const before = prev.get(id);
    let tokensPerSecond = null;
    if (generating && before && before.taskId === taskId && decoded > before.decoded) {
      const deltaMs = now - before.at;
      if (deltaMs > 0) tokensPerSecond = ((decoded - before.decoded) / deltaMs) * 1000;
    }

    slots.push({
      id,
      taskId,
      state: !busy ? 'idle' : generating ? 'generating' : 'prompt',
      promptProcessed: busy ? asInt(entry.n_prompt_tokens_processed) : 0,
      promptCached: busy ? asInt(entry.n_prompt_tokens_cache) : 0,
      decoded,
      remaining: generating ? remaining : null,
      tokensPerSecond,
    });

    prev.set(id, { taskId, decoded, at: now });
  }

  return slots;
}

/**
 * Read llama.cpp's deferred-request gauge from Prometheus `/metrics` text.
 * Upstream emits `llamacpp:requests_deferred`; some exporters use underscores.
 *
 * @param {unknown} text
 * @returns {number}
 */
export function parseLlamaCppDeferred(text) {
  if (typeof text !== 'string' || !text) return 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(
      /^llamacpp(?::|_)requests_deferred(?:\{[^}]*\})?\s+([0-9]+(?:\.[0-9]+)?)\b/,
    );
    if (!match) continue;
    const n = Number(match[1]);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }
  return 0;
}

/**
 * One `/slots` request. Resolves to null on any failure — including a timeout, which
 * on this endpoint usually means the server is too busy to answer, not that it died.
 * @param {string} baseUrl
 * @returns {Promise<unknown | null>}
 */
async function fetchSlots(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/slots`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One `/metrics` request. Resolves to the raw Prometheus body, or null on failure.
 * @param {string} baseUrl
 * @returns {Promise<string | null>}
 */
async function fetchMetricsText(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/metrics`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    if (typeof res.text === 'function') return await res.text();
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start polling a running llama.cpp serve. Idempotent — a second call for the same
 * serve is a no-op, so the crash watcher and the heartbeat can both ask.
 *
 * @param {{ id: string, baseUrl: string, runtime?: string, modelLabel?: string, libraryId?: string }} serve
 */
export function startServeActivity(serve) {
  if (!serve?.id || !serve.baseUrl) return;
  if (serve.runtime && serve.runtime !== 'llama-cpp') return;
  if (pollers.has(serve.id)) return;

  // Carried on every sample so the header picker — which holds no serve list — can
  // match a row without a second round trip.
  const identity = {
    modelLabel: String(serve.modelLabel ?? ''),
    libraryId: serve.libraryId ? String(serve.libraryId) : null,
  };

  const entry = { timer: null, stopped: false, last: null, prev: new Map() };
  pollers.set(serve.id, entry);

  const tick = async () => {
    if (entry.stopped) return;
    const [raw, metricsText] = await Promise.all([
      fetchSlots(serve.baseUrl),
      fetchMetricsText(serve.baseUrl),
    ]);
    if (entry.stopped) return;

    const now = Date.now();
    // Keep the last deferred count when /metrics is silent — a saturated
    // server often stops answering both endpoints together.
    const queued =
      metricsText != null ? parseLlamaCppDeferred(metricsText) : (entry.last?.queued ?? 0);
    let activity;
    if (raw == null) {
      // Keep the last good sample rather than flipping every panel to Ready. A busy
      // server that stopped answering is the exact case this must not misreport.
      activity = entry.last
        ? { ...entry.last, queued, stale: true }
        : {
            serveId: serve.id,
            ...identity,
            updatedAt: now,
            available: false,
            stale: true,
            queued,
            slots: [],
          };
    } else {
      activity = {
        serveId: serve.id,
        ...identity,
        updatedAt: now,
        available: true,
        stale: false,
        queued,
        slots: normalizeSlots(raw, entry.prev, now),
      };
    }

    entry.last = activity;
    publish(activity);

    const busy =
      activity.queued > 0 || activity.slots.some((slot) => slot.state !== 'idle');
    entry.timer = setTimeout(() => {
      void tick();
    }, busy && !activity.stale ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
    entry.timer.unref?.();
  };

  void tick();
}

/** Stop polling a serve. Safe to call for a serve that was never polled. */
export function stopServeActivity(serveId) {
  const entry = pollers.get(serveId);
  if (!entry) return;
  entry.stopped = true;
  if (entry.timer) clearTimeout(entry.timer);
  pollers.delete(serveId);
}

/** Stop every poller (app shutdown, tests). */
export function stopAllServeActivity() {
  for (const serveId of [...pollers.keys()]) stopServeActivity(serveId);
}

/**
 * Latest sample for a serve, marked stale when it has aged out. Null when the serve
 * was never polled.
 * @param {string} serveId
 * @returns {ServeActivity | null}
 */
export function getServeActivity(serveId) {
  const entry = pollers.get(serveId);
  if (!entry?.last) return null;
  const stale = entry.last.stale || Date.now() - entry.last.updatedAt > STALE_AFTER_MS;
  return stale === entry.last.stale ? entry.last : { ...entry.last, stale };
}

/** Every current sample — the initial payload for a new SSE subscriber. */
export function listServeActivity() {
  const out = [];
  for (const serveId of pollers.keys()) {
    const activity = getServeActivity(serveId);
    if (activity) out.push(activity);
  }
  return out;
}
