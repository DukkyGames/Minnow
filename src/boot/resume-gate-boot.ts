/**
 * Boot resume gate — ask before restarting work that was interrupted by a crash
 * or a force-quit.
 *
 * Chats used to restart with no prompt at all: a chat whose reply was still
 * streaming, one with an unfinished tool batch, or one stamped `resumeInterrupted`
 * by Quit Minnow all resumed on their own. They now wait for an answer here.
 *
 * Orchestrate boards are gated too, but the hold lives on the server
 * (`server/orchestrator/resume-gate.js`): under V2 a board resumes when its
 * engine loads, which any request can trigger, so the renderer can only ask
 * which boards are held and relay the answer.
 */

import { getActiveChat, saveSessionsNow } from '../state/sessions.ts';
import type { Chat, SessionState } from '../types.ts';
import { listChatsWithGenerationId } from '../chat/generation-resume.ts';
import { hasIncompleteToolBatchForBoot } from '../chat/incomplete-tool-resume.ts';
import { setResumeGateState } from '../chat/resume-gate.ts';
import {
  fetchPendingBoardResumes,
  resolveBoardResumes,
  type PendingBoardResume,
} from './board-resume-gate-client.ts';
import {
  clearResumeInterruptedForChats,
  isChatResumeInterrupted,
} from '../chat/resume-interrupted.ts';
import { reportBackgroundError } from './report-background-error.ts';
import { showResumePromptModal, type ResumePromptItem } from '../ui/resume-prompt-modal.ts';

/** Why a chat is a resume candidate — a live generation, unfinished tools, or quit mid-turn. */
type ChatCandidateKind = 'generation' | 'tool-batch' | 'interrupted';

export interface ResumeChatCandidate {
  chat: Chat;
  kind: ChatCandidateKind;
}

export interface ResumeCandidates {
  chats: ResumeChatCandidate[];
  boards: PendingBoardResume[];
}

function hasCandidates(candidates: ResumeCandidates): boolean {
  return candidates.chats.length > 0 || candidates.boards.length > 0;
}

/**
 * Everything the three boot resumes would restart, plus chats stamped
 * `resumeInterrupted` by Quit Minnow / crash mid-turn (generation id may already
 * be gone after a clean shutdown cancel).
 *
 * Hydrates the active chat's history (the tool-batch scan needs it), so this must
 * be awaited before the prompt.
 */
export async function collectResumeCandidates(state: SessionState): Promise<ResumeCandidates> {
  const chats: ResumeChatCandidate[] = [];
  const seen = new Set<string>();

  const pushChat = (chat: Chat, kind: ChatCandidateKind): void => {
    if (seen.has(chat.id)) return;
    seen.add(chat.id);
    chats.push({ chat, kind });
  };

  // Boot generation / tool resume only ever resumes the active chat; match that
  // exactly so the prompt never lists work it would not actually restart.
  const activeId = getActiveChat()?.id;
  const active = listChatsWithGenerationId(state.chats).find((chat) => chat.id === activeId);
  if (active) {
    pushChat(active, 'generation');
  } else if (await hasIncompleteToolBatchForBoot()) {
    const activeChat = getActiveChat();
    if (activeChat) pushChat(activeChat, 'tool-batch');
  }

  // Quit/crash marker can outlive currentGenerationId (graceful Quit cancels gens).
  // List every stamped chat so background work is visible; Resume still only
  // reconnects the active chat (others clear the marker after the answer).
  for (const chat of state.chats) {
    if (!isChatResumeInterrupted(chat)) continue;
    pushChat(chat, 'interrupted');
  }

  return { chats, boards: await fetchPendingBoardResumes() };
}

/**
 * Arm the gate hold synchronously, before anything at boot can restart a chat.
 *
 * Chat resume is already explicit — nothing runs until `runBootResumeGate` calls
 * it — so this only has to flip the hold other boot paths check. Kept cheap and
 * synchronous on purpose: it must land before the first `await` in `initApp`.
 */
export function parkResumeCandidatesAtBoot(state: SessionState): void {
  const hasInterrupted = state.chats.some((chat) => isChatResumeInterrupted(chat));
  const hasGeneration = listChatsWithGenerationId(state.chats).length > 0;
  if (!hasInterrupted && !hasGeneration) return;
  setResumeGateState('pending');
}

function describeChatCandidate(candidate: ResumeChatCandidate): ResumePromptItem {
  const detail =
    candidate.kind === 'generation'
      ? 'Reply was still streaming'
      : candidate.kind === 'tool-batch'
        ? 'Tool call never finished'
        : 'Turn was interrupted when Minnow closed';
  return {
    label: candidate.chat.name?.trim() || 'Untitled chat',
    detail,
  };
}

function describeBoardCandidate(candidate: PendingBoardResume): ResumePromptItem {
  const count = candidate.taskCount;
  return {
    label: `${candidate.name?.trim() || 'Board'} — orchestrate board`,
    detail: count ? `${count} task${count === 1 ? '' : 's'}, still running` : 'Still running',
  };
}

/** Drop stale generation / interrupt markers ("Don't resume"). */
function declineResume(candidates: ResumeCandidates): void {
  // Server-side stop, so the board shows Stopped and the next boot stays quiet.
  if (candidates.boards.length) void resolveBoardResumes('decline');

  clearResumeInterruptedForChats(
    candidates.chats.map((c) => c.chat),
    { clearGenerationId: true },
  );
  // Persist immediately so a second crash cannot resurrect what was just declined.
  if (candidates.chats.length) saveSessionsNow();
}

/** Run the resume prompt (or, with nothing pending, today's plain boot resume). */
export async function runBootResumeGate(state: SessionState): Promise<void> {
  const candidates = await collectResumeCandidates(state);

  const { bootGenerationResumeForChats } = await import('../chat/generation-resume.ts');
  const { bootIncompleteToolResumeForChats } = await import('../chat/incomplete-tool-resume.ts');

  if (!hasCandidates(candidates)) {
    // Nothing interrupted — boot exactly as before, no prompt.
    setResumeGateState('resumed');
    await bootGenerationResumeForChats(state.chats);
    await bootIncompleteToolResumeForChats(state.chats);
    return;
  }

  setResumeGateState('pending');

  const choice = await showResumePromptModal([
    ...candidates.chats.map(describeChatCandidate),
    ...candidates.boards.map(describeBoardCandidate),
  ]);

  if (choice === 'decline') {
    declineResume(candidates);
    setResumeGateState('declined');
    return;
  }

  setResumeGateState('resumed');

  // Releases the tick timers `engine.load()` withheld for these boards.
  if (candidates.boards.length) await resolveBoardResumes('resume');

  await bootGenerationResumeForChats(state.chats);
  await bootIncompleteToolResumeForChats(state.chats);

  // Markers are spent once the user answers Resume — clear so Agent Activity and
  // a later quit do not re-prompt for work that already ran (or had nothing left).
  clearResumeInterruptedForChats(candidates.chats.map((c) => c.chat));
  if (candidates.chats.length) saveSessionsNow();
}

/** Boot entry point — never rejects, never blocks the rest of `initApp`. */
export function startBootResumeGate(state: SessionState): void {
  void runBootResumeGate(state).catch((err) => {
    reportBackgroundError('resume-gate', err);
    // Leave the hold in place: failing open would restart work unprompted, which
    // is the exact behavior this gate exists to prevent.
    setResumeGateState('declined');
  });
}

/** Test helper — drop gate state between runs. */
export function resetResumeGateBootForTests(): void {
  setResumeGateState('idle');
}
