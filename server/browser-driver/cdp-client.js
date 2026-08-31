/**
 * P5-A — Minimal Chrome DevTools Protocol client (MIN-719).
 *
 * Restored from `server/cdp/client.js`, deleted in 86cc513f when browser tools
 * were routed through the Electron preview. Originally ported from
 * opencode-browser (MIT) — https://github.com/different-ai/opencode-browser
 *
 * Hardened for unattended use, three changes from the original:
 *
 * 1. `ws` is imported lazily, so this module can be loaded (and the rest of the
 *    driver unit-tested) in an environment where node_modules is absent.
 * 2. The per-command deadline is a parameter rather than a hardcoded 30 s.
 * 3. **A close or error rejects every pending call.** The original left them
 *    pending forever, which is precisely how a dead browser hangs its caller.
 */

/**
 * @typedef {object} CDPResponse
 * @property {number} id
 * @property {Record<string, unknown>} [result]
 * @property {{ code: number, message: string }} [error]
 */

/** Thrown for every failure mode a caller needs to tell apart. */
export class CdpError extends Error {
  /**
   * @param {string} message
   * @param {'timeout' | 'closed' | 'protocol' | 'connect'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'CdpError';
    this.code = code;
  }
}

/** @type {Promise<any> | null} */
let wsModulePromise = null;

/**
 * Resolve the `ws` implementation once. Kept lazy so importing this module never
 * requires node_modules to be present.
 * @returns {Promise<any>}
 */
export async function loadWebSocketImpl() {
  if (!wsModulePromise) {
    wsModulePromise = import('ws').then((m) => m.default ?? m);
  }
  return wsModulePromise;
}

export class CdpClient {
  /**
   * @param {string} endpoint WebSocket debugger URL
   * @param {{ commandTimeoutMs?: number }} [opts]
   */
  constructor(endpoint, opts = {}) {
    this.endpoint = endpoint;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 15_000;
    /** @type {any} */
    this.ws = null;
    this.nextId = 0;
    this.closed = false;
    /** @type {string | null} */
    this.closeReason = null;
    /** @type {Map<number, { reject: (e: Error) => void, settle: (msg: CDPResponse) => void }>} */
    this.pending = new Map();
    /** @type {Map<string, Array<(params: Record<string, unknown>) => void>>} */
    this.eventHandlers = new Map();
  }

  /**
   * @param {number} [connectTimeoutMs]
   * @returns {Promise<void>}
   */
  async connect(connectTimeoutMs = 15_000) {
    if (this.ws && this.ws.readyState === 1) return;
    const WebSocketImpl = await loadWebSocketImpl();
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.terminate?.();
        } catch {
          /* ignore */
        }
        reject(new CdpError(`timed out connecting to ${this.endpoint}`, 'connect'));
      }, connectTimeoutMs);

      const ws = new WebSocketImpl(this.endpoint, { maxPayload: 64 * 1024 * 1024 });
      this.ws = ws;

      ws.once('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      });
      ws.once('error', (/** @type {Error} */ err) => {
        this.#failAllPending(new CdpError(`websocket error: ${err.message}`, 'closed'));
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new CdpError(`websocket error: ${err.message}`, 'connect'));
      });
      ws.on('message', (/** @type {Buffer} */ data) => this.#onMessage(data));
      ws.on('close', () => {
        this.closed = true;
        this.#failAllPending(
          new CdpError(this.closeReason ?? 'CDP connection closed', 'closed'),
        );
      });
    });
  }

  /** @param {Buffer} data */
  #onMessage(data) {
    /** @type {CDPResponse & { method?: string, params?: Record<string, unknown> }} */
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        entry.settle(msg);
      }
    }
    if (msg.method) {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params ?? {});
          } catch {
            /* a listener must never break the socket */
          }
        }
      }
    }
  }

  /** @param {Error} err */
  #failAllPending(err) {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(err);
  }

  /**
   * Send a CDP command and await its result.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<Record<string, unknown>>}
   */
  async send(method, params = {}, opts = {}) {
    if (this.closed || !this.ws || this.ws.readyState !== 1) {
      throw new CdpError(this.closeReason ?? 'CDP not connected', 'closed');
    }
    const id = ++this.nextId;
    const timeoutMs = opts.timeoutMs ?? this.commandTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP timeout after ${timeoutMs}ms: ${method}`, 'timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        settle: (msg) => {
          clearTimeout(timer);
          if (msg.error) {
            reject(new CdpError(`CDP error (${method}): ${msg.error.message}`, 'protocol'));
          } else {
            resolve(msg.result ?? {});
          }
        },
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new CdpError(`failed to send ${method}: ${String(err)}`, 'closed'));
      }
    });
  }

  /**
   * @param {string} event CDP event name, e.g. `Page.loadEventFired`
   * @param {(params: Record<string, unknown>) => void} handler
   */
  on(event, handler) {
    const list = this.eventHandlers.get(event) ?? [];
    list.push(handler);
    this.eventHandlers.set(event, list);
  }

  /**
   * Remove a handler registered with {@link on}. Long-lived sessions navigate
   * repeatedly; without this, every navigation leaks a listener that keeps
   * firing for the pages that follow it.
   * @param {string} event
   * @param {(params: Record<string, unknown>) => void} handler
   */
  off(event, handler) {
    const list = this.eventHandlers.get(event);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this.eventHandlers.delete(event);
  }

  /**
   * Close the socket and reject anything still in flight.
   * @param {string} [reason]
   */
  close(reason = 'CDP connection closed by driver') {
    this.closeReason = reason;
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      this.ws?.terminate?.();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.#failAllPending(new CdpError(reason, 'closed'));
  }
}

/**
 * @param {string} wsUrl
 * @param {{ commandTimeoutMs?: number, connectTimeoutMs?: number }} [opts]
 * @returns {Promise<CdpClient>}
 */
export async function connectTarget(wsUrl, opts = {}) {
  const client = new CdpClient(wsUrl, { commandTimeoutMs: opts.commandTimeoutMs });
  await client.connect(opts.connectTimeoutMs);
  return client;
}
