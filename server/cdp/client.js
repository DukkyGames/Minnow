/**
 * Minimal Chrome DevTools Protocol client (WebSocket).
 * Ported from opencode-browser (MIT) — https://github.com/different-ai/opencode-browser
 */

import WebSocket from 'ws';

/**
 * @typedef {object} CDPResponse
 * @property {number} id
 * @property {Record<string, unknown>} [result]
 * @property {{ code: number; message: string }} [error]
 */

export class CDPClient {
  /** @param {string} endpoint WebSocket debugger URL */
  constructor(endpoint) {
    this.endpoint = endpoint;
    /** @type {WebSocket | null} */
    this.ws = null;
    this.id = 0;
    /** @type {Map<number, { resolve: (msg: CDPResponse) => void; reject: (e: Error) => void }>} */
    this.pending = new Map();
    /** @type {Map<string, Array<(params: Record<string, unknown>) => void>>} */
    this.eventHandlers = new Map();
  }

  /** Open the WebSocket if not already connected. */
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.endpoint);
      this.ws.once('open', () => resolve());
      this.ws.once('error', (err) => reject(err));
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
        if (msg.method && this.eventHandlers.has(msg.method)) {
          for (const handler of this.eventHandlers.get(msg.method)) {
            handler(msg.params ?? {});
          }
        }
      });
      this.ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  /**
   * Send a CDP command and await the result.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   */
  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('CDP not connected');
    }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timeout);
          if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
          else resolve(msg.result ?? {});
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Register a handler for CDP events (e.g. Page.loadEventFired). */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Connect to a specific target WebSocket URL.
 * @param {string} wsUrl
 * @returns {Promise<CDPClient>}
 */
export async function connectTarget(wsUrl) {
  const client = new CDPClient(wsUrl);
  await client.connect();
  return client;
}
