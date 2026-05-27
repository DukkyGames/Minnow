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
  findBugById,
  updateBug,
} from '../../state/bug-board-store.ts';
import { decodeModelSelectKey } from '../../lib/model-select-key.ts';
import {
  createEmptyChatObject,
  findChatById,
  scheduleSaveSessions,
  sessionState,
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

/** Create or reuse the investigation chat for a bug. */
function ensureInvestigationChat(bug: BugCard): Chat | null {
  if (bug.chatId) {
    const existing = findChatById(bug.chatId);
    if (existing) return existing;
  }
  if (!sessionState) return null;

  const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const rawSel = modelSelect?.value?.trim() ?? '';
  const parsed = decodeModelSelectKey(rawSel);
  const modelId = parsed?.modelId ?? rawSel;
  const chat = createEmptyChatObject(modelId, bug.workspacePath);
  if (parsed) chat.providerId = parsed.providerId;
  chat.name = `Bug: ${bug.title.slice(0, 48)}`;
  chat.modeId = 'build';

  sessionState.chats.unshift(chat);
  sessionState.activeId = chat.id;
  touchChat(chat);
  updateBug(bug.id, { chatId: chat.id, column: 'investigating' });
  scheduleSaveSessions();

  void import('../../ui/sidebar.ts').then((m) => {
    m.renderSidebar();
    m.syncModelSelectForActiveChat();
  });
  void import('../../ui/messages.ts').then((m) => m.renderChatFromHistory(chat));

  return chat;
}

/** Run debugger sub-agent in a new investigation chat. */
export async function runBugInvestigate(
  bugId: string,
): Promise<{ ok: boolean; error?: string; chatId?: string }> {
  const bug = findBugById(bugId);
  if (!bug) return { ok: false, error: 'Bug not found' };

  const chat = ensureInvestigationChat(bug);
  if (!chat) return { ok: false, error: 'Could not create investigation chat' };

  updateBug(bugId, { column: 'investigating', chatId: chat.id });

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

    updateBug(bugId, { investigateRunId: runId });

    const settled = await waitForSubAgent(runId);
    updateBug(bugId, {
      notes: settled.summary.slice(0, 4000),
      column: 'investigating',
    });

    return {
      ok: settled.ok,
      error: settled.ok ? undefined : settled.summary,
      chatId: chat.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Run planner sub-agent in the investigation chat. */
export async function runBugPlanFix(
  bugId: string,
): Promise<{ ok: boolean; planPath?: string; error?: string }> {
  const bug = findBugById(bugId);
  if (!bug) return { ok: false, error: 'Bug not found' };

  const chat = bug.chatId ? findChatById(bug.chatId) : null;
  if (!chat) {
    return { ok: false, error: 'Run Investigate first to create an investigation chat' };
  }

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

    updateBug(bugId, { planRunId: runId, planPath });

    const settled = await waitForSubAgent(runId);
    if (settled.ok) {
      const notes = bug.notes
        ? `${bug.notes}\n\n---\nPlan: ${planPath}`
        : `Plan ready: ${planPath}`;
      updateBug(bugId, {
        column: 'planned',
        planPath,
        notes,
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
  bugId: string,
  sendKickoff: (message: string) => void | Promise<void>,
): Promise<{ ok: boolean; error?: string }> {
  const bug = findBugById(bugId);
  if (!bug) return { ok: false, error: 'Bug not found' };
  const planPath = bug.planPath?.trim();
  if (!planPath) return { ok: false, error: 'No plan path — run Plan fix first' };

  const chat = bug.chatId ? findChatById(bug.chatId) : null;
  if (!chat) {
    return { ok: false, error: 'Run Investigate first to create an investigation chat' };
  }

  updateBug(bugId, { column: 'fixing' });
  chat.orchestratePlanPath = planPath;
  touchChat(chat);
  scheduleSaveSessions();

  if (sessionState) sessionState.activeId = chat.id;
  scheduleSaveSessions();

  const modeResult = setChatMode('orchestrate');
  if (!modeResult.ok) {
    return { ok: false, error: modeResult.error ?? 'Could not switch to Orchestrate mode' };
  }

  const active = findChatById(chat.id);
  if (!active) {
    return { ok: false, error: 'Investigation chat not found' };
  }

  active.viewMode = 'board';
  touchChat(active);
  scheduleSaveSessions();
  setOrchestrateViewMode('board');

  try {
    await sendKickoff(ORCHESTRATE_BOARD_KICKOFF_MESSAGE);
    updateBug(bugId, { column: 'fixing' });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Mark bug complete (e.g. after orchestrator finishes). */
export function markBugComplete(bugId: string): void {
  updateBug(bugId, { column: 'complete' });
}
