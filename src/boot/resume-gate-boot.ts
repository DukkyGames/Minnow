/**
 * Boot resume gate — ask before restarting work that was interrupted by a crash,
 * a force-quit, or a normal quit with a board still mid-plan.
 *
 * Two paths used to restart work with no prompt at all: a crashed board kept
 * `autoRunning: true` and resumed at boot, and a cleanly quit board was
 * system-paused but then silently re-armed by the first display-wake reconcile
 * after launch. Both now wait for an answer here.
 */

import { getPlannerChatForGroup } from '../state/chat-groups.ts';
import {
  isBoardCandidateForWakeReconcile,
  stopBoardAutoRun,
} from '../state/orchestrate-board-actions.ts';
import { getActiveChat, saveSessionsNow, touchChat } from '../state/sessions.ts';
import type { Chat, ChatGroup, SessionState } from '../types.ts';
import { listChatsWithGenerationId } from '../chat/generation-resume.ts';
import { hasIncompleteToolBatchForBoot } from '../chat/incomplete-tool-resume.ts';
import {
  bootOrchestrateBoardRepair,
  bootOrchestrateBoardResume,
  resumeRunningBoardsAfterGate,
} from '../chat/orchestrate/board-boot-resume.ts';
import { syncBoardLivenessPollAfterResumeGate } from '../chat/orchestrate/board-display-wake.ts';
import { setResumeGateState } from '../chat/resume-gate.ts';
import { reportBackgroundError } from './report-background-error.ts';
import { showResumePromptModal, type ResumePromptItem } from '../ui/resume-prompt-modal.ts';

/** Why a chat is a resume candidate — a live generation, or an unfinished tool batch. */
type ChatCandidateKind = 'generation' | 'tool-batch';

export interface ResumeChatCandidate {
  chat: Chat;
  kind: ChatCandidateKind;
}

export interface ResumeBoardCandidate {
  group: ChatGroup;
}

export interface ResumeCandidates {
  chats: ResumeChatCandidate[];
  boards: ResumeBoardCandidate[];
}

/** Boards whose `autoRunning` this module cleared while the prompt is up. */
const parkedBoardAutoRunning = new Map<string, boolean | undefined>();

/** Group lookup for unparking, rebuilt each gate run (groups are stable objects). */
let currentGroupsById = new Map<string, ChatGroup>();

function hasCandidates(candidates: ResumeCandidates): boolean {
  return candidates.chats.length > 0 || candidates.boards.length > 0;
}

/**
 * Boards that boot resume or the wake reconcile would restart.
 *
 * Parking already cleared `autoRunning` on the boards it caught, which would make
 * the predicate answer "no" the second time around — so an already-parked board
 * counts as a candidate on its own.
 */
export function collectBoardResumeCandidates(state: SessionState): ResumeBoardCandidate[] {
  const boards: ResumeBoardCandidate[] = [];
  for (const group of state.groups ?? []) {
    if (!group.orchestrateBoard) continue;
    // One predicate for both restart paths — the crash case (`autoRunning`) and
    // the clean-quit case (`systemPaused` with work left) both land here.
    if (!parkedBoardAutoRunning.has(group.id) && !isBoardCandidateForWakeReconcile(group)) {
      continue;
    }
    if (!getPlannerChatForGroup(group)) continue;
    boards.push({ group });
  }
  return boards;
}

/**
 * Everything the three boot resumes would restart. Hydrates the active chat's
 * history (the tool-batch scan needs it), so this must be awaited before the prompt.
 */
export async function collectResumeCandidates(state: SessionState): Promise<ResumeCandidates> {
  const chats: ResumeChatCandidate[] = [];

  // Boot generation resume only ever resumes the active chat; match that exactly
  // so the prompt never lists work it would not actually restart.
  const activeId = getActiveChat()?.id;
  const active = listChatsWithGenerationId(state.chats).find((chat) => chat.id === activeId);
  if (active) {
    chats.push({ chat: active, kind: 'generation' });
  } else if (await hasIncompleteToolBatchForBoot()) {
    const activeChat = getActiveChat();
    if (activeChat) chats.push({ chat: activeChat, kind: 'tool-batch' });
  }

  return { chats, boards: collectBoardResumeCandidates(state) };
}

/**
 * Clear `autoRunning` on every candidate board, synchronously, before anything
 * else at boot can read it. Nothing can launch while the prompt is up: every
 * delegation path is behind `isBoardRunning`, and the wake path is behind the
 * resume-gate hold this arms.
 *
 * In-memory only — the parked value is restored verbatim on Resume, and a decline
 * persists a real Stop instead.
 */
export function parkResumeCandidatesAtBoot(state: SessionState): void {
  const boards = collectBoardResumeCandidates(state);
  if (!boards.length) return;

  setResumeGateState('pending');
  for (const { group } of boards) {
    const board = group.orchestrateBoard;
    if (!board) continue;
    parkedBoardAutoRunning.set(group.id, board.autoRunning);
    board.autoRunning = false;
  }
}

function unparkBoards(): void {
  for (const [groupId, autoRunning] of parkedBoardAutoRunning) {
    const group = currentGroupsById.get(groupId);
    const board = group?.orchestrateBoard;
    if (!board) continue;
    board.autoRunning = autoRunning;
  }
  parkedBoardAutoRunning.clear();
}

function describeChatCandidate(candidate: ResumeChatCandidate): ResumePromptItem {
  return {
    label: candidate.chat.name?.trim() || 'Untitled chat',
    detail:
      candidate.kind === 'generation'
        ? 'Reply was still streaming'
        : 'Tool call never finished',
  };
}

function describeBoardCandidate(candidate: ResumeBoardCandidate): ResumePromptItem {
  const board = candidate.group.orchestrateBoard;
  const tasks = board?.tasks ?? [];
  const running = tasks.filter(
    (t) => t.status === 'in_progress' || t.status === 'testing' || t.status === 'merging',
  ).length;
  const planned = tasks.filter((t) => t.status === 'planned').length;
  const parts: string[] = [];
  if (running) parts.push(`${running} in progress`);
  if (planned) parts.push(`${planned} queued`);
  return {
    label: `${candidate.group.name?.trim() || 'Board'} — orchestrate board`,
    detail: parts.length ? parts.join(', ') : 'Plan not finished',
  };
}

/** Stop each candidate board and drop stale generation ids (the "Don't resume" branch). */
function declineResume(candidates: ResumeCandidates): void {
  for (const { group } of candidates.boards) {
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    // Same state a user Stop produces: the board shows Stopped, Start re-arms it,
    // and `userStopped` keeps the wake reconcile from ever picking it back up.
    stopBoardAutoRun(group, planner, { reason: 'user' });
  }
  parkedBoardAutoRunning.clear();

  let touchedChat = false;
  for (const { chat, kind } of candidates.chats) {
    if (kind !== 'generation') continue;
    if (chat.currentGenerationId == null) continue;
    delete chat.currentGenerationId;
    touchChat(chat);
    touchedChat = true;
  }
  // Persist immediately so a second crash cannot resurrect what was just declined.
  if (touchedChat) saveSessionsNow();
}

/** Run the resume prompt (or, with nothing pending, today's plain boot resume). */
export async function runBootResumeGate(state: SessionState): Promise<void> {
  currentGroupsById = new Map((state.groups ?? []).map((group) => [group.id, group]));

  const candidates = await collectResumeCandidates(state);

  if (!hasCandidates(candidates)) {
    // Nothing interrupted — boot exactly as before, no prompt.
    unparkBoards();
    setResumeGateState('resumed');
    await bootOrchestrateBoardResume(state);
    return;
  }

  setResumeGateState('pending');
  // Repair (wake hooks, OOM probe, interrupted merges) is safe with the boards
  // parked and runs whichever way the user answers.
  const oomPause = await bootOrchestrateBoardRepair(state);
  if (oomPause) {
    // An OOM pause already means "press Start when ready" — do not double-prompt.
    parkedBoardAutoRunning.clear();
    setResumeGateState('declined');
    return;
  }

  const choice = await showResumePromptModal([
    ...candidates.chats.map(describeChatCandidate),
    ...candidates.boards.map(describeBoardCandidate),
  ]);

  if (choice === 'decline') {
    declineResume(candidates);
    setResumeGateState('declined');
    return;
  }

  unparkBoards();
  setResumeGateState('resumed');
  syncBoardLivenessPollAfterResumeGate();

  const { bootGenerationResumeForChats } = await import('../chat/generation-resume.ts');
  const { bootIncompleteToolResumeForChats } = await import('../chat/incomplete-tool-resume.ts');
  await bootGenerationResumeForChats(state.chats);
  await bootIncompleteToolResumeForChats(state.chats);
  await resumeRunningBoardsAfterGate(state);
}

/** Boot entry point — never rejects, never blocks the rest of `initApp`. */
export function startBootResumeGate(state: SessionState): void {
  void runBootResumeGate(state).catch((err) => {
    reportBackgroundError('boot-resume-gate', err);
    // Leave the hold in place: failing open would restart work unprompted, which
    // is the exact behavior this gate exists to prevent.
    setResumeGateState('declined');
  });
}

/** Test helper — drop parked board state between runs. */
export function resetResumeGateBootForTests(): void {
  parkedBoardAutoRunning.clear();
  currentGroupsById = new Map();
  setResumeGateState('idle');
}
