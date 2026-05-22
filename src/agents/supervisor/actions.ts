/**
 * Side effects for supervisor recovery (resume, sub-agents, board, ask_question).
 */

import { ORCHESTRATE_RESUME_MESSAGE } from '../../chat/orchestrate/resume-message.ts';
import { isActiveChatStreaming } from '../../chat/streaming-state.ts';
import { emitBoardChange } from '../../state/orchestrate-board-events.ts';
import { updateTask } from '../../state/orchestrate-board-store.ts';
import { findChatById, getActiveChat } from '../../state/sessions.ts';
import {
  getSubAgentRun,
  restartSubAgent,
  spawnSubAgent,
} from '../orchestrator.ts';
import { enqueueAskQuestion } from '../../tools/ask-question-queue.ts';
import { getSupervisorConfigSnapshot } from './config.ts';
import { runLlmEscalationJudgement } from './escalation.ts';
import type { SupervisorDecision } from './rules.ts';
import { getRunHealth, getSupervisorChatState, markChatStalledForUi } from './state.ts';

let resumeInFlight = false;

async function injectResumeMessage(chatId: string): Promise<void> {
  if (resumeInFlight) return;
  resumeInFlight = true;
  try {
    if (getActiveChat().id !== chatId) return;
    const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = ORCHESTRATE_RESUME_MESSAGE;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const { sendMessage } = await import('../../chat/messaging.ts');
    await sendMessage();
  } finally {
    resumeInFlight = false;
  }
}

function showWatchdogToast(message: string): void {
  const el = document.createElement('div');
  el.className = 'orchestrate-watchdog-toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('orchestrate-watchdog-toast--visible'));
  window.setTimeout(() => {
    el.classList.remove('orchestrate-watchdog-toast--visible');
    window.setTimeout(() => el.remove(), 300);
  }, 5000);
}

/**
 * Apply one supervisor decision produced by `pickSupervisorDecision`.
 */
export async function executeSupervisorDecision(
  chatId: string,
  decision: SupervisorDecision,
): Promise<void> {
  const chat = findChatById(chatId);
  if (!chat?.orchestrateBoard) return;
  const sup = getSupervisorChatState(chatId);
  const board = chat.orchestrateBoard;
  const cfg = getSupervisorConfigSnapshot();

  switch (decision.action) {
    case 'none':
      return;
    case 'budget_stall': {
      markChatStalledForUi(chatId, true);
      emitBoardChange(chatId);
      return;
    }
    case 'inject_resume': {
      if (isActiveChatStreaming() || resumeInFlight) return;
      const taskId =
        typeof decision.payload?.blockingTaskId === 'string'
          ? decision.payload.blockingTaskId
          : null;
      const retriesExhausted = decision.payload?.retriesExhausted === true;
      if (decision.rule === 'R8' && retriesExhausted) {
        markChatStalledForUi(chatId, true);
        emitBoardChange(chatId);
        return;
      }
      if (taskId && decision.rule === 'R8') {
        const task = board.tasks.find((t) => t.id === taskId);
        updateTask(chat, taskId, {
          retryCount: (task?.retryCount ?? 0) + 1,
        });
      }
      markChatStalledForUi(chatId, false);
      showWatchdogToast('Orchestrator stalled — resuming plan…');
      emitBoardChange(chatId);
      await injectResumeMessage(chatId);
      return;
    }
    case 'restart_run': {
      const runId = typeof decision.payload?.runId === 'string' ? decision.payload.runId : '';
      if (!runId) return;
      const h = getRunHealth(runId);
      h.restartCount += 1;
      try {
        await restartSubAgent(runId, {
          note: '[Supervisor] Sub-agent had no tool activity; restarting run.',
          preserveType: true,
        });
      } catch {
        /* run may have ended */
      }
      emitBoardChange(chatId);
      return;
    }
    case 'respawn_task': {
      if (decision.rule === 'R2') {
        const taskId =
          (typeof decision.payload?.boardTaskId === 'string' && decision.payload.boardTaskId.trim()
            ? decision.payload.boardTaskId.trim()
            : '') || '';
        const subType = typeof decision.payload?.type === 'string' ? decision.payload.type : 'generalPurpose';
        const category =
          decision.payload?.category === 'build' ||
          decision.payload?.category === 'fix' ||
          decision.payload?.category === 'test' ||
          decision.payload?.category === 'research'
            ? decision.payload.category
            : 'build';
        const prevTask = typeof decision.payload?.task === 'string' ? decision.payload.task : '';
        if (!taskId) return;
        const count = (sup.spawnCountByTaskId.get(taskId) ?? 0) + 1;
        if (count > cfg.spawnCapPerTask) {
          markChatStalledForUi(chatId, true);
          emitBoardChange(chatId);
          return;
        }
        sup.spawnCountByTaskId.set(taskId, count);
        try {
          await spawnSubAgent({
            type: subType,
            task: `[Supervisor] Prior run completed with an empty summary. Summarize concrete results and next steps.\n\n${prevTask}`,
            wait: false,
            parentTurnId: board.activeParentTurnId ?? null,
            parentChatId: chat.id,
            boardTaskId: taskId,
            modeId: 'orchestrate',
            category,
          });
        } catch {
          /* ignore */
        }
        emitBoardChange(chatId);
        return;
      }

      const runId = typeof decision.payload?.runId === 'string' ? decision.payload.runId : '';
      const run = runId ? getSubAgentRun(runId) : undefined;
      const taskId = run?.boardTaskId?.trim() || '';
      if (!run || !taskId) return;
      if (sup.spawnRetryIssuedForTaskId.has(taskId)) {
        try {
          updateTask(chat, taskId, {
            status: 'blocked',
            error: 'Supervisor: spawn stuck after retry',
          });
        } catch {
          /* ignore */
        }
        emitBoardChange(chatId);
        return;
      }
      sup.spawnRetryIssuedForTaskId.add(taskId);
      try {
        await spawnSubAgent({
          type: run.type,
          task: `[Supervisor] Re-spawn after stuck run (${String(decision.payload?.kind ?? 'unknown')}).\n\n${run.task}`,
          wait: false,
          parentTurnId: board.activeParentTurnId ?? null,
          parentChatId: chat.id,
          boardTaskId: taskId,
          modeId: 'orchestrate',
          category: run.category,
        });
      } catch {
        /* ignore */
      }
      emitBoardChange(chatId);
      return;
    }
    case 'escalate_user': {
      sup.awaitingUserDecision = true;
      try {
        await enqueueAskQuestion(
          {
            title: 'Orchestrate supervisor',
            questions: [
              {
                id: 'supervisor_budget',
                prompt: 'A recovery budget was exhausted. What should we do next?',
                options: [
                  { id: 'retry', label: 'Retry the stuck step' },
                  { id: 'skip', label: 'Skip for now' },
                  { id: 'abort', label: 'Stop orchestration' },
                  { id: 'diagnose', label: 'Open diagnose notes' },
                ],
              },
            ],
          },
          {},
        );
      } finally {
        sup.awaitingUserDecision = false;
      }
      emitBoardChange(chatId);
      return;
    }
    case 'llm_escalate': {
      sup.recoveryInFlight = true;
      try {
        const sub = await runLlmEscalationJudgement(chat, board, sup);
        if (sub != null) {
          sup.llmEscalationsThisSession += 1;
        }
        if (sub && sub.action !== 'none') {
          await executeSupervisorDecision(chatId, sub);
        }
      } finally {
        sup.recoveryInFlight = false;
      }
      return;
    }
    default:
      return;
  }
}

export { resumeInFlight };
