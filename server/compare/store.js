/**
 * Blind compare sessions and vote history under ~/.minnow/compare/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';

const SESSIONS_FILE = 'sessions.json';
const HISTORY_FILE = 'history.json';
const MIN_SLOTS = 2;
const MAX_SLOTS = 6;

/** @typedef {'left' | 'right' | 'tie' | 'both_bad' | number} CompareWinner */

/**
 * @typedef {object} CompareModelRef
 * @property {string} providerId
 * @property {string} modelId
 */

/**
 * @typedef {object} CompareSlot
 * @property {number} screenIndex
 * @property {string} alias
 * @property {CompareModelRef} model
 * @property {number} pickIndex
 * @property {string} generationId
 * @property {boolean} activated
 */

/**
 * @typedef {object} CompareSession
 * @property {string} id
 * @property {string} startedAt
 * @property {string} prompt
 * @property {boolean} parallel
 * @property {CompareSlot[]} slots
 * @property {boolean} voted
 * @property {CompareWinner} [winner]
 * @property {string} [notes]
 * @property {string} [completedAt]
 * @property {CompareModelRef} [left]
 * @property {CompareModelRef} [right]
 * @property {string} [leftGenerationId]
 * @property {string} [rightGenerationId]
 * @property {string} [leftAlias]
 * @property {string} [rightAlias]
 */

/**
 * @typedef {object} CompareSlotRef
 * @property {string} providerId
 * @property {string} modelId
 * @property {string} alias
 */

/**
 * @typedef {object} CompareVote
 * @property {string} id
 * @property {string} startedAt
 * @property {string} completedAt
 * @property {string} prompt
 * @property {CompareSlotRef[]} slots
 * @property {CompareWinner} winner
 * @property {boolean} revealed
 * @property {boolean} [parallel]
 * @property {string} [notes]
 * @property {CompareModelRef} [left]
 * @property {CompareModelRef} [right]
 * @property {{ leftAlias: string; rightAlias: string }} [assignment]
 */

/** @type {Map<string, CompareSession>} */
const activeSessions = new Map();

function compareDir() {
  return path.join(getMinnowHome(), 'compare');
}

function sessionsPath() {
  return path.join(compareDir(), SESSIONS_FILE);
}

function historyPath() {
  return path.join(compareDir(), HISTORY_FILE);
}

/**
 * @param {() => number} [randomFn]
 * @returns {boolean}
 */
function coinFlip(randomFn = Math.random) {
  return randomFn() > 0.5;
}

/**
 * Fisher–Yates shuffle using the supplied random source.
 *
 * @param {number[]} arr
 * @param {() => number} randomFn
 */
function shuffleIndices(arr, randomFn) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * @param {unknown} value
 * @returns {value is CompareModelRef}
 */
function isModelRef(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof /** @type {CompareModelRef} */ (value).providerId === 'string' &&
    typeof /** @type {CompareModelRef} */ (value).modelId === 'string'
  );
}

/**
 * @param {CompareSession} session
 */
function syncLegacyTwoUpFields(session) {
  if (session.slots.length !== 2) return;
  const leftSlot = session.slots.find((s) => s.screenIndex === 0);
  const rightSlot = session.slots.find((s) => s.screenIndex === 1);
  if (!leftSlot || !rightSlot) return;
  session.left = leftSlot.model;
  session.right = rightSlot.model;
  session.leftGenerationId = leftSlot.generationId;
  session.rightGenerationId = rightSlot.generationId;
  session.leftAlias = leftSlot.alias;
  session.rightAlias = rightSlot.alias;
}

/**
 * @param {unknown} raw
 * @returns {CompareSession | null}
 */
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const row = /** @type {CompareSession} */ (raw);

  if (typeof row.id !== 'string' || typeof row.prompt !== 'string') {
    return null;
  }

  if (Array.isArray(row.slots) && row.slots.length >= MIN_SLOTS) {
    const slots = row.slots.filter(
      (slot) =>
        slot &&
        typeof slot.screenIndex === 'number' &&
        typeof slot.alias === 'string' &&
        isModelRef(slot.model) &&
        typeof slot.generationId === 'string',
    );
    if (slots.length < MIN_SLOTS) return null;
    row.slots = slots;
    row.parallel = row.parallel !== false;
    syncLegacyTwoUpFields(row);
    return row;
  }

  if (
    typeof row.leftGenerationId === 'string' &&
    typeof row.rightGenerationId === 'string' &&
    isModelRef(row.left) &&
    isModelRef(row.right)
  ) {
    row.parallel = row.parallel !== false;
    row.slots = [
      {
        screenIndex: 0,
        alias: row.leftAlias ?? 'A',
        model: row.left,
        pickIndex: 0,
        generationId: row.leftGenerationId,
        activated: true,
      },
      {
        screenIndex: 1,
        alias: row.rightAlias ?? 'B',
        model: row.right,
        pickIndex: 1,
        generationId: row.rightGenerationId,
        activated: true,
      },
    ];
    return row;
  }

  return null;
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

/** Load persisted sessions into memory (unfinished votes). */
export async function loadPersistedSessions() {
  await ensureMinnowLayout();
  const rows = await readJsonFile(sessionsPath(), []);
  if (!Array.isArray(rows)) return;
  for (const raw of rows) {
    const session = normalizeSession(raw);
    if (session && !session.voted) {
      activeSessions.set(session.id, session);
    }
  }
}

async function persistActiveSessions() {
  const rows = [...activeSessions.values()].filter((s) => !s.voted);
  await writeJsonFile(sessionsPath(), rows);
}

async function readHistoryRows() {
  const rows = await readJsonFile(historyPath(), []);
  return Array.isArray(rows) ? rows : [];
}

async function appendHistoryVote(vote) {
  const rows = await readHistoryRows();
  rows.unshift(vote);
  await writeJsonFile(historyPath(), rows.slice(0, 500));
}

/**
 * Build blind slot assignments from user picks and optional generation ids.
 *
 * @param {{
 *   picks: CompareModelRef[];
 *   generationIds: string[];
 *   parallel: boolean;
 *   randomFn?: () => number;
 * }} input
 * @returns {CompareSlot[]}
 */
function buildBlindSlots(input) {
  const { picks, generationIds, parallel, randomFn = Math.random } = input;
  const n = picks.length;

  if (n === 2) {
    const swapColumns = coinFlip(randomFn);
    const leftGetsA = coinFlip(randomFn);
    const screenLeft = swapColumns ? picks[1] : picks[0];
    const screenRight = swapColumns ? picks[0] : picks[1];
    const leftGen = swapColumns ? generationIds[1] : generationIds[0];
    const rightGen = swapColumns ? generationIds[0] : generationIds[1];
    const leftPickIndex = swapColumns ? 1 : 0;
    const rightPickIndex = swapColumns ? 0 : 1;
    const leftAlias = parallel ? (leftGetsA ? 'A' : 'B') : '1';
    const rightAlias = parallel ? (leftGetsA ? 'B' : 'A') : '2';
    return [
      {
        screenIndex: 0,
        alias: leftAlias,
        model: screenLeft,
        pickIndex: leftPickIndex,
        generationId: leftGen ?? '',
        activated: Boolean(leftGen),
      },
      {
        screenIndex: 1,
        alias: rightAlias,
        model: screenRight,
        pickIndex: rightPickIndex,
        generationId: rightGen ?? '',
        activated: Boolean(rightGen),
      },
    ];
  }

  const order = [...Array(n).keys()];
  shuffleIndices(order, randomFn);
  return order.map((pickIdx, screenIdx) => ({
    screenIndex: screenIdx,
    alias: parallel ? String.fromCharCode(65 + screenIdx) : String(screenIdx + 1),
    model: picks[pickIdx],
    pickIndex: pickIdx,
    generationId: generationIds[pickIdx] ?? '',
    activated: Boolean(generationIds[pickIdx]),
  }));
}

/**
 * Create a blind compare session with randomized column assignment.
 *
 * @param {{
 *   prompt: string;
 *   picks: CompareModelRef[];
 *   generationIds: string[];
 *   parallel?: boolean;
 *   randomFn?: () => number;
 * }} input
 * @returns {CompareSession}
 */
export function createSession(input) {
  const picks = input.picks;
  if (!Array.isArray(picks) || picks.length < MIN_SLOTS || picks.length > MAX_SLOTS) {
    throw new Error(`Compare requires ${MIN_SLOTS}–${MAX_SLOTS} models`);
  }
  for (const pick of picks) {
    if (!isModelRef(pick)) {
      throw new Error('Invalid model pick');
    }
  }

  const parallel = input.parallel !== false;
  const generationIds = input.generationIds ?? picks.map(() => '');
  const slots = buildBlindSlots({
    picks,
    generationIds,
    parallel,
    randomFn: input.randomFn,
  });

  /** @type {CompareSession} */
  const session = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    prompt: input.prompt,
    parallel,
    slots,
    voted: false,
  };

  syncLegacyTwoUpFields(session);
  activeSessions.set(session.id, session);
  void persistActiveSessions();
  return session;
}

/**
 * @param {string} id
 * @returns {CompareSession | undefined}
 */
export function getSession(id) {
  return activeSessions.get(id);
}

/**
 * Assign generation ids by user pick index (parallel kickoff).
 *
 * @param {string} sessionId
 * @param {string[]} generationIdsByPick
 */
export function assignPickGenerations(sessionId, generationIdsByPick) {
  const session = getSession(sessionId);
  if (!session) return;
  for (const slot of session.slots) {
    const genId = generationIdsByPick[slot.pickIndex] ?? '';
    if (genId) {
      slot.generationId = genId;
      slot.activated = true;
    }
  }
  syncLegacyTwoUpFields(session);
  activeSessions.set(sessionId, session);
  void persistActiveSessions();
}

/**
 * @param {CompareSession} session
 * @returns {CompareSlotRef[]}
 */
function sessionSlotsPublic(session) {
  return session.slots.map((slot) => ({
    providerId: slot.model.providerId,
    modelId: slot.model.modelId,
    alias: slot.alias,
  }));
}

/**
 * Public session view — hides provider/model ids until voted.
 *
 * @param {string} id
 * @returns {object | null}
 */
export function getSessionPublic(id) {
  const session = getSession(id);
  if (!session) return null;
  const slots = session.slots.map((slot) => ({
    generationId: slot.generationId,
    label: slot.alias,
    activated: slot.activated,
  }));
  const payload = {
    id: session.id,
    startedAt: session.startedAt,
    prompt: session.prompt,
    parallel: session.parallel,
    slots,
    voted: session.voted,
  };
  if (session.slots.length === 2) {
    payload.left = slots[0];
    payload.right = slots[1];
  }
  return payload;
}

/**
 * Resolve a stream key (`0`, `left`, …) to a screen slot index.
 *
 * @param {CompareSession} session
 * @param {string} key
 * @returns {number | null}
 */
export function resolveStreamSlotIndex(session, key) {
  if (key === 'left') return 0;
  if (key === 'right') return 1;
  const idx = Number(key);
  if (!Number.isInteger(idx) || idx < 0 || idx >= session.slots.length) {
    return null;
  }
  return idx;
}

/**
 * @param {CompareSession} session
 * @param {number} screenIndex
 * @returns {CompareSlot | undefined}
 */
export function getSlotByScreenIndex(session, screenIndex) {
  return session.slots.find((slot) => slot.screenIndex === screenIndex);
}

/**
 * Mark a slot generation as started.
 *
 * @param {string} sessionId
 * @param {number} screenIndex
 * @param {string} generationId
 * @returns {{ slot: CompareSlot } | { error: string }}
 */
export function activateSlotGeneration(sessionId, screenIndex, generationId) {
  const session = getSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }
  const slot = getSlotByScreenIndex(session, screenIndex);
  if (!slot) {
    return { error: 'Invalid slot index' };
  }
  if (slot.activated && slot.generationId) {
    return { slot };
  }
  slot.generationId = generationId;
  slot.activated = true;
  syncLegacyTwoUpFields(session);
  activeSessions.set(sessionId, session);
  void persistActiveSessions();
  return { slot };
}

/**
 * Normalize winner to a screen slot index when possible.
 *
 * @param {CompareSession} session
 * @param {CompareWinner} winner
 * @returns {number | 'tie' | 'both_bad' | null}
 */
export function normalizeWinner(session, winner) {
  if (winner === 'tie' || winner === 'both_bad') {
    return winner;
  }
  if (typeof winner === 'number' && Number.isInteger(winner)) {
    if (winner < 0 || winner >= session.slots.length) return null;
    return winner;
  }
  if (winner === 'left') return 0;
  if (winner === 'right') return 1;
  return null;
}

/**
 * @param {string} id
 * @param {CompareWinner} winner
 * @param {string} [notes]
 * @returns {{ session: CompareSession; vote: CompareVote } | { error: string }}
 */
export async function recordVote(id, winner, notes) {
  const session = getSession(id);
  if (!session) {
    return { error: 'Session not found' };
  }
  if (session.voted) {
    return { error: 'Already voted' };
  }

  const normalized = normalizeWinner(session, winner);
  if (normalized === null) {
    return { error: 'Invalid winner' };
  }

  const completedAt = new Date().toISOString();
  session.voted = true;
  session.winner = winner;
  session.notes = typeof notes === 'string' ? notes.trim() : undefined;
  session.completedAt = completedAt;

  const slotRefs = sessionSlotsPublic(session);

  /** @type {CompareVote} */
  const vote = {
    id: session.id,
    startedAt: session.startedAt,
    completedAt,
    prompt: session.prompt,
    slots: slotRefs,
    winner,
    revealed: true,
    parallel: session.parallel,
    notes: session.notes,
  };

  if (session.slots.length === 2 && session.left && session.right) {
    vote.left = session.left;
    vote.right = session.right;
    vote.assignment = {
      leftAlias: session.leftAlias ?? session.slots[0].alias,
      rightAlias: session.rightAlias ?? session.slots[1].alias,
    };
  }

  await appendHistoryVote(vote);
  activeSessions.set(id, session);
  await persistActiveSessions();
  return { session, vote };
}

/**
 * @param {number} [limit]
 * @returns {Promise<CompareVote[]>}
 */
export async function listHistory(limit = 50) {
  await ensureMinnowLayout();
  const rows = await readHistoryRows();
  const votes = rows.filter((row) => row && row.revealed === true);
  return votes.slice(0, Math.max(1, Math.min(limit, 200)));
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteSession(id) {
  const existed = activeSessions.delete(id);
  await persistActiveSessions();
  return existed;
}

/** Reset in-memory state (tests). */
export function resetCompareStoreForTests() {
  activeSessions.clear();
}

/** Clear persisted compare history (tests). */
export async function resetCompareHistoryForTests() {
  await ensureMinnowLayout();
  await writeJsonFile(historyPath(), []);
  await writeJsonFile(sessionsPath(), []);
}
