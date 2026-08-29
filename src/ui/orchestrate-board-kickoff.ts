/**
 * Orchestrate board kickoff: git preflight (programmatic init, optional /git-setup
 * for GitHub remote), then board_init message.
 */

import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import { resolveEffectiveOrchestratePlanPathWithSync } from '../chat/orchestrate/plan-path-sync';
import { isActiveChatStreaming } from '../chat/streaming-state';
import { GIT_SETUP_SKILL_ID } from '../skills/git-setup-client';
import { formatHistoryWithSkillTag } from '../skills/parse-slash';
import { getBoardGroupForChat } from '../state/chat-groups';
import { getWorkspaceGitStatus } from '../state/git-workspace';
import { initializeWorkspaceGit } from '../state/initialize-git';
import { getActiveChat } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { detectLocalServer } from '../tools/client';
import { buildHistoryUserContent, runChatTurn } from '../tools/loop';
import {
  getBoardKickoffAbortSignal,
  isBoardKickoffInProgress,
  promptBoardGitSetup,
  setBoardKickoffInProgress,
  setBoardOnboardingAwaitingInit,
  setBoardOnboardingGitSetupActive,
} from './orchestrate-board-onboarding-state';
import { setStatus } from './status';

/** First user turn from Board onboarding before the model runs board_init (MIN-5). */
export const BOARD_ONBOARDING_KICKOFF_MESSAGE =
  'Parse the selected plan and call board_init with each task\'s build and test spec and category. Do not start any tasks.';

/**
 * Substring present in every board-init kickoff: the pathless constant, path-named
 * builder output, and older transcripts that used the bare constant.
 */
export const BOARD_ONBOARDING_KICKOFF_MARKER =
  "call board_init with each task's build and test spec and category. Do not start any tasks.";

/** Legacy alias for onboarding kickoff (historical transcripts / init-split detection). */
export const BOARD_BUILD_KICKOFF_MESSAGE = BOARD_ONBOARDING_KICKOFF_MESSAGE;

/**
 * Build the board_init kickoff user turn. When a plan path is already bound, name it
 * so the model does not invent an ask_question plan picker.
 */
export function buildBoardOnboardingKickoffMessage(planPath?: string | null): string {
  const normalized = normalizeOrchestratePlanPath(planPath ?? '');
  if (!normalized) return BOARD_ONBOARDING_KICKOFF_MESSAGE;
  return (
    `Parse the selected plan at \`${normalized}\` and call board_init with each task's ` +
    'build and test spec and category. Do not start any tasks. Do not ask which plan to use.'
  );
}

/** Skip a second kickoff when launch or onboarding already posted the init message. */
export function shouldSkipDuplicateBoardOnboardingKickoff(chat: {
  history: Array<{ role: string; content?: unknown }>;
}): boolean {
  if (isBoardKickoffInProgress()) return true;
  if (isActiveChatStreaming()) return true;
  for (let i = chat.history.length - 1; i >= 0; i -= 1) {
    const msg = chat.history[i];
    if (msg.role !== 'user') continue;
    const text = typeof msg.content === 'string' ? msg.content : '';
    return text.includes(BOARD_ONBOARDING_KICKOFF_MARKER);
  }
  return false;
}

const GIT_SETUP_REMOTE_USER_TEXT =
  'Connect a GitHub remote for this workspace. Skip git init if the repository is already initialized.';

/** Posts a user message through the composer and triggers sendMessage. */
function sendBoardMessage(text: string): void {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  void import('../chat/messaging').then((m) => m.sendMessage());
}

function kickoffAborted(): boolean {
  return getBoardKickoffAbortSignal()?.aborted ?? false;
}

/**
 * Init / .gitignore / first commit without the /git-setup LLM skill (MIN-615).
 * Returns false when init fails so kickoff can stop before board_init.
 */
async function runProgrammaticGitInit(): Promise<boolean> {
  const { refreshBoardOnboardingIfMounted } = await import('./orchestrate-board');
  setBoardOnboardingGitSetupActive(true);
  refreshBoardOnboardingIfMounted();
  try {
    const result = await initializeWorkspaceGit(getWorkspacePath());
    void import('./composer-undo').then((m) => m.invalidateComposerUndoGitCache());
    if (!result.ok) {
      setStatus('err', result.error ?? 'Could not initialize git in this workspace.');
      return false;
    }
    return true;
  } finally {
    setBoardOnboardingGitSetupActive(false);
    refreshBoardOnboardingIfMounted();
  }
}

/** Run /git-setup in the planner chat for GitHub remote only. */
async function runGitSetupRemoteSkillTurn(
  chat: ReturnType<typeof getActiveChat>,
): Promise<void> {
  const { refreshBoardOnboardingIfMounted } = await import('./orchestrate-board');
  setBoardOnboardingGitSetupActive(true);
  refreshBoardOnboardingIfMounted();
  try {
    const userText = GIT_SETUP_REMOTE_USER_TEXT;
    const displayText = formatHistoryWithSkillTag(userText, GIT_SETUP_SKILL_ID);
    const historyContent = buildHistoryUserContent(displayText, []);
    await runChatTurn({
      chat,
      pushUser: true,
      rawText: `/${GIT_SETUP_SKILL_ID} ${userText}`,
      userText,
      skillId: GIT_SETUP_SKILL_ID,
      displayText,
      historyContent,
      validAttachments: [],
      titleSeed: userText,
      shouldScheduleTitle: false,
      skillBody: null,
      ownsGlobalStreaming: chat.id === getActiveChat().id,
    });
  } finally {
    setBoardOnboardingGitSetupActive(false);
    refreshBoardOnboardingIfMounted();
  }
}

/** Ensure the tool server is up before git init or a remote skill turn. */
async function ensureToolServerForGitSetup(): Promise<boolean> {
  const serverUp = await detectLocalServer();
  if (!serverUp) {
    setStatus('err', 'Minnow must be running locally for git setup — open or restart the app.');
  }
  return serverUp;
}

/**
 * Git preflight → programmatic init (MIN-615) → optional remote skill → board_init.
 * Entry points: hub Open board, onboarding Start, plan screen Open board.
 */
export async function kickoffOrchestrateBoardBuild(): Promise<void> {
  if (setBoardKickoffInProgress(true)) return;

  const { refreshBoardOnboardingIfMounted } = await import('./orchestrate-board');

  try {
    const chat = getActiveChat();
    let gitStatus = await getWorkspaceGitStatus(getWorkspacePath());
    if (kickoffAborted()) return;

    if (!gitStatus.isGitRepo) {
      const initAccepted = await promptBoardGitSetup('init');
      if (kickoffAborted()) return;

      if (initAccepted) {
        if (!(await ensureToolServerForGitSetup())) return;
        // Do not run /git-setup here — the model re-asks via ask_question (MIN-615).
        const inited = await runProgrammaticGitInit();
        if (kickoffAborted()) return;
        if (!inited) return;
        gitStatus = await getWorkspaceGitStatus(getWorkspacePath());
      }
    }

    if (gitStatus.isGitRepo && !gitStatus.hasRemote) {
      const remoteAccepted = await promptBoardGitSetup('remote');
      if (kickoffAborted()) return;

      if (remoteAccepted) {
        if (!(await ensureToolServerForGitSetup())) return;
        await runGitSetupRemoteSkillTurn(chat);
        if (kickoffAborted()) return;
      }
    }

    const planPath = resolveEffectiveOrchestratePlanPathWithSync(
      chat,
      getBoardGroupForChat(chat),
      { sync: true },
    );
    sendBoardMessage(buildBoardOnboardingKickoffMessage(planPath));
    setBoardOnboardingAwaitingInit(true);
  } finally {
    setBoardKickoffInProgress(false);
    refreshBoardOnboardingIfMounted();
  }
}
