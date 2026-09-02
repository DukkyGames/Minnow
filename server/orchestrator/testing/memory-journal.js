/**
 * An in-memory journal store, satisfying the same interface as `journal.js`.
 */

import { derive } from '../core/derive.js';
import { validateEvent } from '../core/events.js';

/**
 * @returns {{
 *   appendEvent: (boardId: string, event: Record<string, unknown>, options?: { now?: () => number }) => Promise<Record<string, unknown>>,
 *   appendEvents: (boardId: string, events: Record<string, unknown>[], options?: { now?: () => number }) => Promise<Record<string, unknown>[]>,
 *   readEvents: (boardId: string) => Promise<Record<string, unknown>[]>,
 *   readHighestSeq: (boardId: string) => Promise<number>,
 *   loadState: (boardId: string) => Promise<import('../core/types').BoardState>,
 *   createBoard: (boardId: string) => Promise<void>,
 *   boardExists: (boardId: string) => Promise<boolean>,
 *   listBoards: () => Promise<string[]>,
 *   readEventsSync: (boardId: string) => Record<string, unknown>[],
 * }}
 */
export function createMemoryJournal() {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const journals = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const chains = new Map();

  /**
   * @template T
   * @param {string} boardId
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function serialise(boardId, task) {
    const previous = chains.get(boardId) ?? Promise.resolve();
    const next = previous.then(task, task);
    chains.set(
      boardId,
      next.catch(() => {}),
    );
    return next;
  }

  /**
   * @param {string} boardId
   * @returns {Record<string, unknown>[]}
   */
  function bucket(boardId) {
    let events = journals.get(boardId);
    if (!events) {
      events = [];
      journals.set(boardId, events);
    }
    return events;
  }

  /**
   * @param {string} boardId
   * @param {Record<string, unknown>[]} events
   * @param {{ now?: () => number }} options
   * @returns {Promise<Record<string, unknown>[]>}
   */
  function appendAll(boardId, events, options) {
    const now = options.now ?? (() => 0);
    return serialise(boardId, async () => {
      const target = bucket(boardId);
      let seq = target.length > 0 ? Number(target[target.length - 1].seq) : 0;

      /** @type {Record<string, unknown>[]} */
      const stamped = [];
      for (const event of events) {
        seq += 1;
        const line = { v: 1, ...event, seq, ts: now() };
        const checked = validateEvent(line);
        if (!checked.ok) {
          throw new Error(`refusing to journal an invalid event: ${checked.error}`);
        }
        stamped.push(JSON.parse(JSON.stringify(line)));
      }
      target.push(...stamped);
      return stamped;
    });
  }

  return {
    appendEvent(boardId, event, options = {}) {
      return appendAll(boardId, [event], options).then((events) => events[0]);
    },

    appendEvents(boardId, events, options = {}) {
      return appendAll(boardId, events, options);
    },

    async readEvents(boardId) {
      return [...bucket(boardId)];
    },

    async readHighestSeq(boardId) {
      const events = bucket(boardId);
      return events.length > 0 ? Number(events[events.length - 1].seq) : 0;
    },

    async loadState(boardId) {
      return derive(bucket(boardId));
    },

    async createBoard(boardId) {
      bucket(boardId);
    },

    async boardExists(boardId) {
      return journals.has(boardId);
    },

    async listBoards() {
      return [...journals.keys()].sort();
    },

    readEventsSync(boardId) {
      return [...bucket(boardId)];
    },
  };
}
