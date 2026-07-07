/**
 * In-process email event bus + SSE subscribers for live UI refresh.
 */

import { EventEmitter } from 'node:events';

/** @type {EventEmitter} */
const bus = new EventEmitter();
bus.setMaxListeners(50);

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

/**
 * Emit an email lifecycle event to SSE subscribers.
 * @param {string} type
 * @param {Record<string, unknown>} payload
 */
export function emitEmailEvent(type, payload = {}) {
  const event = {
    type,
    at: new Date().toISOString(),
    ...payload,
  };
  bus.emit(type, event);
  bus.emit('*', event);

  const data = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * Subscribe to all email events (server-side hooks).
 * @param {(event: Record<string, unknown>) => void} listener
 */
export function onEmailEvent(listener) {
  bus.on('*', listener);
  return () => bus.off('*', listener);
}

/**
 * Handle GET /api/email/events — Server-Sent Events stream.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function handleEmailEventsSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

/** Reset SSE clients (tests). */
export function resetEmailEventsForTests() {
  for (const res of sseClients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();
  bus.removeAllListeners();
}
