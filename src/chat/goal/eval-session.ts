/**
 * Live goal-evaluator session state for the parent chat UI (drawer + status row).
 */

import type { ApiMessage } from '../../types';

export type GoalEvalSessionStatus = 'running' | 'completed' | 'failed';

/** In-memory evaluator run for one chat (replaced on each evaluation pass). */
export interface GoalEvalSession {
  chatId: string;
  conditionText: string;
  status: GoalEvalSessionStatus;
  startedAt: number;
  endedAt?: number;
  messages: ApiMessage[];
  verificationToolCalls: number;
  /** Tool name shown in the drawer footer while tools execute. */
  liveCurrentToolName?: string;
  rawVerdict?: string;
  met?: boolean;
  reason?: string;
}

type GoalEvalSessionListener = (session: GoalEvalSession) => void;

const sessionsByChatId = new Map<string, GoalEvalSession>();
const listeners = new Set<GoalEvalSessionListener>();

function emit(session: GoalEvalSession): void {
  for (const fn of listeners) {
    try {
      fn(session);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Register a listener; returns an unsubscribe function. */
export function subscribeGoalEvalSessions(listener: GoalEvalSessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Clear listeners (test teardown). */
export function clearGoalEvalSessionListeners(): void {
  listeners.clear();
}

/** Reset all sessions (test teardown). */
export function resetGoalEvalSessionsForTests(): void {
  sessionsByChatId.clear();
  clearGoalEvalSessionListeners();
}

/** Latest evaluator session for a chat, if any. */
export function getGoalEvalSession(chatId: string): GoalEvalSession | null {
  const id = chatId.trim();
  if (!id) return null;
  return sessionsByChatId.get(id) ?? null;
}

/** Begin a new evaluation pass (replaces any prior session for this chat). */
export function startGoalEvalSession(chatId: string, conditionText: string): GoalEvalSession {
  const id = chatId.trim();
  const session: GoalEvalSession = {
    chatId: id,
    conditionText: conditionText.trim(),
    status: 'running',
    startedAt: Date.now(),
    messages: [],
    verificationToolCalls: 0,
  };
  sessionsByChatId.set(id, session);
  emit(session);
  return session;
}

/** Patch the live session (no-op when the chat has no active session). */
export function patchGoalEvalSession(
  chatId: string,
  patch: Partial<
    Pick<
      GoalEvalSession,
      | 'messages'
      | 'verificationToolCalls'
      | 'liveCurrentToolName'
      | 'rawVerdict'
      | 'status'
      | 'endedAt'
      | 'met'
      | 'reason'
    >
  >,
): void {
  const session = getGoalEvalSession(chatId);
  if (!session) return;
  Object.assign(session, patch);
  emit(session);
}

/** Mark the session terminal after evaluateGoal resolves. */
export function finishGoalEvalSession(
  chatId: string,
  result: {
    met: boolean;
    reason: string;
    rawVerdict: string;
    verificationToolCalls: number;
  },
): void {
  const session = getGoalEvalSession(chatId);
  if (!session) return;
  session.status = 'completed';
  session.endedAt = Date.now();
  session.met = result.met;
  session.reason = result.reason;
  session.rawVerdict = result.rawVerdict;
  session.verificationToolCalls = result.verificationToolCalls;
  session.liveCurrentToolName = undefined;
  emit(session);
}
