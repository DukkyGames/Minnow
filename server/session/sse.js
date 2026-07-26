/**
 * SSE fan-out for session state changes (/api/session/stream).
 * Reuses per-subscriber write-queue + drain handling from generations/store.js.
 */

/** @typedef {import('http').ServerResponse} ServerResponse */

/** @type {Set<ServerResponse>} */
const subscribers = new Set();

/**
 * @typedef {{ queue: Buffer[], draining: boolean }} SubscriberWriteState
 */

/** @type {WeakMap<ServerResponse, SubscriberWriteState>} */
const subscriberWrites = new WeakMap();

/**
 * @param {ServerResponse} res
 * @returns {SubscriberWriteState}
 */
function getWriteState(res) {
  let w = subscriberWrites.get(res);
  if (!w) {
    w = { queue: [], draining: false };
    subscriberWrites.set(res, w);
  }
  return w;
}

/**
 * @param {ServerResponse} res
 * @returns {boolean}
 */
function canWrite(res) {
  return !res.writableEnded && !res.destroyed;
}

/**
 * @param {ServerResponse} res
 */
function detachSubscriber(res) {
  subscribers.delete(res);
  subscriberWrites.delete(res);
  if (!res.writableEnded && !res.destroyed) {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {ServerResponse} res
 * @param {Buffer} [buf]
 */
function flushSubscriberQueue(res, buf) {
  if (!canWrite(res)) {
    detachSubscriber(res);
    return;
  }

  const w = getWriteState(res);
  if (buf) {
    w.queue.push(buf);
  }

  while (w.queue.length > 0) {
    if (!subscribers.has(res)) {
      subscriberWrites.delete(res);
      return;
    }

    const chunk = w.queue.shift();
    try {
      const ok = res.write(chunk);
      if (!ok) {
        if (!w.draining) {
          w.draining = true;
          res.once('drain', () => {
            w.draining = false;
            flushSubscriberQueue(res);
          });
        }
        return;
      }
    } catch {
      detachSubscriber(res);
      return;
    }
  }
}

/**
 * @param {ServerResponse} res
 * @param {string} eventName
 * @param {unknown} payload
 * @param {number} rev
 */
function enqueueSseEvent(res, eventName, payload, rev) {
  if (!canWrite(res) || !subscribers.has(res)) {
    detachSubscriber(res);
    return;
  }
  const data = `id: ${rev}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  flushSubscriberQueue(res, Buffer.from(data, 'utf8'));
}

/**
 * @param {string} eventName
 * @param {{ rev: number, state: unknown }} payload
 */
export function broadcastSessionEvent(eventName, payload) {
  for (const res of subscribers) {
    enqueueSseEvent(res, eventName, payload, payload.rev);
  }
}

/**
 * Publish a session state change to all SSE subscribers.
 * @param {number} rev
 * @param {unknown} state
 */
export function publishSessionPatch(rev, state) {
  broadcastSessionEvent('patch', { rev, state });
}

/**
 * Attach a new SSE client; sends an initial snapshot.
 * @param {import('http').IncomingMessage} req
 * @param {ServerResponse} res
 * @param {{ rev: number, state: unknown }} snapshot
 */
export function addSessionStreamSubscriber(req, res, snapshot) {
  // Same-origin only — do not emit Access-Control-Allow-Origin (auth invariant).
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Session-Rev': String(snapshot.rev),
  });
  res.write(': connected\n\n');

  subscribers.add(res);

  enqueueSseEvent(res, 'snapshot', snapshot, snapshot.rev);

  const heartbeat = setInterval(() => {
    try {
      if (!canWrite(res)) {
        clearInterval(heartbeat);
        detachSubscriber(res);
        return;
      }
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      detachSubscriber(res);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    detachSubscriber(res);
  });
}

/** @returns {number} */
export function getSessionSubscriberCount() {
  return subscribers.size;
}

/** Reset subscribers (tests). */
export function resetSessionSseForTests() {
  for (const res of subscribers) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  subscribers.clear();
}
