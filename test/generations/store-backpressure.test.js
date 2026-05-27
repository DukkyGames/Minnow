/**
 * Subscriber backpressure: one drain listener, no duplicate bytes on drain.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createGenerationState,
  appendChunk,
  addSubscriber,
} from '../../server/generations/store.js';

/**
 * Minimal ServerResponse mock: buffers writes, signals backpressure after `limit` bytes.
 * @param {number} limit
 */
function createBackpressureResponse(limit) {
  const ee = new EventEmitter();
  let buffered = 0;

  const res = Object.assign(ee, {
    writableEnded: false,
    destroyed: false,
    /** @type {Buffer[]} */
    parts: [],
    write(buf) {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      this.parts.push(b);
      buffered += b.length;
      if (buffered > limit) {
        return false;
      }
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    destroy() {
      this.destroyed = true;
    },
    /** Unblock one pending drain wait (simulates TCP catching up). */
    unblock() {
      buffered = 0;
      ee.emit('drain');
    },
  });

  return res;
}

describe('generations store backpressure', () => {
  it('queues chunks and uses at most one drain listener', () => {
    const state = createGenerationState({ providerId: 'p', body: {} });
    const res = createBackpressureResponse(8);
    addSubscriber(state, res);

    const chunks = [
      Buffer.from('aaaa', 'utf8'),
      Buffer.from('bbbb', 'utf8'),
      Buffer.from('cccc', 'utf8'),
      Buffer.from('dddd', 'utf8'),
      Buffer.from('eeee', 'utf8'),
      Buffer.from('ffff', 'utf8'),
      Buffer.from('gggg', 'utf8'),
      Buffer.from('hhhh', 'utf8'),
      Buffer.from('iiii', 'utf8'),
      Buffer.from('jjjj', 'utf8'),
      Buffer.from('kkkk', 'utf8'),
    ];

    for (const chunk of chunks) {
      appendChunk(state, chunk);
    }

    assert.equal(res.listenerCount('drain'), 1, 'only one drain listener while backpressured');

    const expected = Buffer.concat(chunks);

    while (res.listenerCount('drain') > 0) {
      res.unblock();
    }

    const written = Buffer.concat(res.parts);
    assert.equal(written.compare(expected), 0, 'no duplicate bytes after drain');
    assert.equal(res.listenerCount('drain'), 0);
  });
});
