/**
 * Sub-agent journal binding (P8-D / MIN-757).
 *
 * Thin wrap of P8-B's generic store onto namespace `'agents'`, so a parent
 * chat's runs live at `~/.minnow/agents/<parentChatId>/journal.jsonl`. The
 * graph fold and event schema are this directory's, not the board ones —
 * dumping sub-agent payloads into board `EVENT_SCHEMAS` would couple two
 * journals that share only an envelope.
 *
 * Snapshots are omitted on purpose: a parent chat's journal is small (one
 * run, a handful of attempts) and P8-F can add memoisation if replay ever
 * shows up in a profile. A snapshot is a cache, never a source.
 */

import { AGENTS_NAMESPACE, derive } from './derive.js';
import { validateEvent } from './events.js';
import { createJournalStore } from '../orchestrator/journal-store.js';

const agents = createJournalStore({
  namespace: AGENTS_NAMESPACE,
  idKind: 'parentChat',
  fold: derive,
  validate: validateEvent,
});

export { AGENTS_NAMESPACE };

/** @param {string} parentChatId */
export function agentsDir(parentChatId) {
  return agents.entryDir(parentChatId);
}

/** @param {string} parentChatId */
export function journalPath(parentChatId) {
  return agents.journalPath(parentChatId);
}

export const readEvents = agents.readEvents;
export const readHighestSeq = agents.readHighestSeq;
export const appendEvent = agents.appendEvent;
export const appendEvents = agents.appendEvents;
export const loadState = agents.loadState;
export const createEntry = agents.createEntry;
export const entryExists = agents.entryExists;
export const deleteEntry = agents.deleteEntry;
export const listEntries = agents.listEntries;
export const resetJournalCache = agents.resetCache;
