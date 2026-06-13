/**
 * Blind compare sessions and vote history under ~/.minnow/compare/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';

const SESSIONS_FILE = 'sessions.json';
const HISTORY_FILE = 'history.json';

/** @typedef {'left' | 'right' | 'tie' | 'both_bad'} CompareWinner */

/**
 * @typedef {object} CompareModelRef
 * @property {string} providerId
 * @property {string} modelId
 */

/**
 * @typedef {object} CompareSession
 * @property {string} id
 * @property {string} startedAt
 * @property {string} prompt
 * @property {string} leftGenerationId
 * @property {string} rightGenerationId
 * @property {'A' | 'B'} leftAlias
 * @property {'A' | 'B'} rightAlias
 * @property {CompareModelRef} left
 * @property {CompareModelRef} right
 * @property {boolean} voted
 * @property {CompareWinner} [winner]
 * @property {string} [notes]
 * @property {string} [completedAt]
 */

/**
 * @typedef {object} CompareVote
 * @property {string} id
 * @property {string} startedAt
 * @property {string} completedAt
 * @property {string} prompt
 * @property {CompareModelRef} left
 * @property {CompareModelRef} right
 * @property {{ leftAlias: 'A' | 'B'; rightAlias: 'A' | 'B' }} assignment
 * @property {CompareWinner} winner
 * @property {boolean} revealed
 * @property {string} [notes]
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
 * @param {unknown} raw
 * @returns {CompareSession | null}
 */
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const row = /** @type {CompareSession} */ (raw);
  if (
    typeof row.id !== 'string' ||
    typeof row.prompt !== 'string' ||
    typeof row.leftGenerationId !== 'string' ||
    typeof row.rightGenerationId !== 'string' ||
    !isModelRef(row.left) ||
    !isModelRef(row.right)
  ) {
    return null;
  }
  return row;
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
 * Create a blind compare session with randomized column assignment.
 *
 * @param {{
 *   prompt: string;
 *   pickLeft: CompareModelRef;
 *   pickRight: CompareModelRef;
 *   leftGenerationId: string;
 *   rightGenerationId: string;
 *   randomFn?: () => number;
 * }} input
 * @returns {CompareSession}
 */
export function createSession(input) {
  const randomFn = input.randomFn ?? Math.random;
  // Randomize which user pick (model 1 / model 2) lands on each screen column.
  const swapColumns = coinFlip(randomFn);
  const screenLeft = swapColumns ? input.pickRight : input.pickLeft;
  const screenRight = swapColumns ? input.pickLeft : input.pickRight;
  const leftGenerationId = swapColumns
    ? input.rightGenerationId
    : input.leftGenerationId;
  const rightGenerationId = swapColumns
    ? input.leftGenerationId
    : input.rightGenerationId;
  const leftGetsA = coinFlip(randomFn);

  /** @type {CompareSession} */
  const session = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    prompt: input.prompt,
    leftGenerationId,
    rightGenerationId,
    leftAlias: leftGetsA ? 'A' : 'B',
    rightAlias: leftGetsA ? 'B' : 'A',
    left: screenLeft,
    right: screenRight,
    voted: false,
  };

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
 * Public session view — hides provider/model ids until voted.
 *
 * @param {string} id
 * @returns {object | null}
 */
export function getSessionPublic(id) {
  const session = getSession(id);
  if (!session) return null;
  return {
    id: session.id,
    startedAt: session.startedAt,
    prompt: session.prompt,
    left: { generationId: session.leftGenerationId, label: session.leftAlias },
    right: { generationId: session.rightGenerationId, label: session.rightAlias },
    voted: session.voted,
  };
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

  const completedAt = new Date().toISOString();
  session.voted = true;
  session.winner = winner;
  session.notes = typeof notes === 'string' ? notes.trim() : undefined;
  session.completedAt = completedAt;

  /** @type {CompareVote} */
  const vote = {
    id: session.id,
    startedAt: session.startedAt,
    completedAt,
    prompt: session.prompt,
    left: session.left,
    right: session.right,
    assignment: { leftAlias: session.leftAlias, rightAlias: session.rightAlias },
    winner,
    revealed: true,
    notes: session.notes,
  };

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
