/**
 * Bug tracker pipeline: Investigate → Plan fix → Start fix (MIN-16).
 */

import { spawnSubAgent, getSubAgentRun } from '../../agents/orchestrator.ts';
import { isSubAgentRunSuccessful } from '../../agents/sub-agent-outcome.ts';
/** Same kickoff line as Orchestrate board onboarding (avoid UI import cycle). */
const ORCHESTRATE_BOARD_KICKOFF_MESSAGE =
  'Initialize the board for the selected plan and begin execution.';
import {
  defaultBugPlanPath,
  updateBug,
} from '../../state/bug-board-store.ts';
import {
  findChatById,
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions.ts';
import type { BugCard, Chat } from '../../types.ts';
import { setChatMode } from '../../ui/mode-selector.ts';
import { setOrchestrateViewMode } from '../../ui/view-mode-toggle.ts';

function buildInvestigateTask(bug: BugCard): string {
  return [
    'Investigate this bug and narrow the root cause.',
    '',
    `Title: ${bug.title}`,
    `Severity: ${bug.severity}`,
    '',
    'Description:',
    bug.description,
    '',
    'Reproduce if possible, gather logs and relevant code paths.',
    'Return a concise summary for the bug card (symptoms, likely cause, suggested next steps).',
  ].join('\n');
}

function buildPlanFixTask(bug: BugCard, planPath: string): string {
  return [
    'Write a fix plan for this bug.',
    '',
    `Title: ${bug.title}`,
    `Severity: ${bug.severity}`,
    '',
    'Description:',
    bug.description,
    '',
    bug.notes ? `Investigation notes:\n${bug.notes}\n` : '',
    `Save the plan to: ${planPath}`,
    '',
    'Use documentation/plans/bugs/ structure with Context, Key Files, Waves, and todos front-matter.',
    'Do not implement the fix — plan only.',
  ].join('\n');
}

async function waitForSubAgent(runId: string): Promise<{ summary: string; ok: boolean }> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const run = getSubAgentRun(runId);
    if (!run) {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (run.status === 'queued' || run.status === 'running') {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    const summary = run.summary?.trim() || run.error?.trim() || '(no summary)';
    return { summary, ok: isSubAgentRunSuccessful(run) };
  }
  return { summary: 'Timed out waiting for sub-agent', ok: false };
}

/** Run debugger sub-agent and move bug to Investigating. */
export async function runBugInvestigate(
  chatId: string,
  bugId: string,
): Promise<{ ok: boolean; error?: string }> {
  const chat = findChatById(chatId);
  const bug = chat?.bugBoard?.bugs.find((b) => b.id === bugId);
  if (!chat || !bug) return { ok: false, error: 'Bug not found' };

  updateBug(chat, bugId, { column: 'investigating' });

  try {
    const result = await spawnSubAgent({
      type: 'debugger',
      task: buildInvestigateTask(bug),
      wait: false,
      parentChatId: chat.id,
      parentTurnId: null,
      category: 'fix',
    });

    const runId =
      'runId' in result && typeof result.runId === 'string' ? result.runId : null;
    if (!runId) return { ok: false, error: 'Failed to spawn debugger' };

    updateBug(chat, bugId, { investigateRunId: runId });

    const settled = await waitForSubAgent(runId);
    updateBug(chat, bugId, {
      notes: settled.summary.slice(0, 4000),
      column: settled.ok ? 'investigating' : 'investigating',
    });

    return { ok: settled.ok, error: settled.ok ? undefined : settled.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Run planner sub-agent and move bug to Planned when plan is written. */
export async function runBugPlanFix(
  chatId: string,
  bugId: string,
): Promise<{ ok: boolean; planPath?: string; error?: string }> {
  const chat = findChatById(chatId);
  const bug = chat?.bugBoard?.bugs.find((b) => b.id === bugId);
  if (!chat || !bug) return { ok: false, error: 'Bug not found' };

  const planPath = bug.planPath?.trim() || defaultBugPlanPath(bugId);

  try {
    const result = await spawnSubAgent({
      type: 'bug-planner',
      task: buildPlanFixTask(bug, planPath),
      wait: false,
      parentChatId: chat.id,
      parentTurnId: null,
      category: 'fix',
    });

    const runId =
      'runId' in result && typeof result.runId === 'string' ? result.runId : null;
    if (!runId) return { ok: false, error: 'Failed to spawn planner' };

    updateBug(chat, bugId, { planRunId: runId, planPath });

    const settled = await waitForSubAgent(runId);
    if (settled.ok) {
      updateBug(chat, bugId, {
        column: 'planned',
        planPath,
        notes: bug.notes
          ? `${bug.notes}\n\n---\nPlan: ${planPath}`
          : `Plan ready: ${planPath}`,
      });
      return { ok: true, planPath };
    }
    return { ok: false, error: settled.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Hand off to Orchestrate with the bug fix plan; moves bug to Fixing. */
export async function runBugStartFix(
  chatId: string,
  bugId: string,
  sendKickoff: (message: string) => void | Promise<void>,
): Promise<{ ok: boolean; error?: string }> {
  const chat = findChatById(chatId);
  const bug = chat?.bugBoard?.bugs.find((b) => b.id === bugId);
  if (!chat || !bug) return { ok: false, error: 'Bug not found' };
  const planPath = bug.planPath?.trim();
  if (!planPath) return { ok: false, error: 'No plan path — run Plan fix first' };

  updateBug(chat, bugId, { column: 'fixing' });
  chat.orchestratePlanPath = planPath;
  touchChat(chat);
  scheduleSaveSessions();

  const modeResult = setChatMode('orchestrate');
  if (!modeResult.ok) {
    return { ok: false, error: modeResult.error ?? 'Could not switch to Orchestrate mode' };
  }

  const active = getActiveChat();
  if (active.id !== chatId) {
    return { ok: false, error: 'Active chat mismatch after mode switch' };
  }

  active.viewMode = 'board';
  touchChat(active);
  scheduleSaveSessions();
  setOrchestrateViewMode('board');

  try {
    await sendKickoff(ORCHESTRATE_BOARD_KICKOFF_MESSAGE);
    updateBug(active, bugId, { column: 'fixing' });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Mark bug complete (e.g. after orchestrator finishes). */
export function markBugComplete(chatId: string, bugId: string): void {
  const chat = findChatById(chatId);
  if (!chat) return;
  updateBug(chat, bugId, { column: 'complete' });
}
