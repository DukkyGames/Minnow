/**
 * Orchestrate board kickoff: git preflight, optional /git-setup skill, then board_init message.
 */

import { GIT_SETUP_SKILL_ID, prepareGitSetupTurn } from '../skills/git-setup-client';
import { formatHistoryWithSkillTag } from '../skills/parse-slash';
import { getWorkspaceGitStatus } from '../state/git-workspace';
import { getActiveChat } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { isServerEngineEnabled } from '../state/server-engine-flag.ts';
import { dispatchSendMessageAndAwaitIdle } from '../state/session-commands.ts';
import { detectLocalServer } from '../tools/client';
import { buildHistoryUserContent, runChatTurn } from '../tools/loop';
import { resolveEffectiveChatModelBinding } from './default-model';
import {
  getBoardKickoffAbortSignal,
  promptBoardGitSetup,
  setBoardKickoffInProgress,
  setBoardOnboardingGitSetupActive,
  type BoardGitPromptKind,
} from './orchestrate-board-onboarding-state';
import { setStatus } from './status';

/** First user turn from Board onboarding before the model runs board_init (MIN-5). */
export const BOARD_ONBOARDING_KICKOFF_MESSAGE =
  'Parse the selected plan and call board_init with each task\'s build and test spec and category. Do not start any tasks.';

/** Legacy alias for onboarding kickoff (historical transcripts / init-split detection). */
export const BOARD_BUILD_KICKOFF_MESSAGE = BOARD_ONBOARDING_KICKOFF_MESSAGE;

const GIT_SETUP_USER_TEXT: Record<BoardGitPromptKind, string> = {
  init:
    'Initialize git in this workspace (init, .gitignore, initial commit). Do not connect a GitHub remote.',
  remote:
    'Connect a GitHub remote for this workspace. Skip git init if the repository is already initialized.',
};

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

/** Run /git-setup in the planner chat and wait for the turn to finish. */
async function runGitSetupSkillTurn(
  chat: ReturnType<typeof getActiveChat>,
  kind: BoardGitPromptKind,
): Promise<void> {
  const { refreshBoardOnboardingIfMounted } = await import('./orchestrate-board');
  setBoardOnboardingGitSetupActive(true);
  refreshBoardOnboardingIfMounted();
  try {
    if (kind === 'init') {
      await prepareGitSetupTurn(getWorkspacePath());
    }
    const userText = GIT_SETUP_USER_TEXT[kind];
    const displayText = formatHistoryWithSkillTag(userText, GIT_SETUP_SKILL_ID);
    const historyContent = buildHistoryUserContent(displayText, []);
    // Engine owns the tool loop — await idle so git status is re-checked after the turn.
    // Slash text carries the skill intent until engine skill resolution lands.
    if (isServerEngineEnabled()) {
      const binding = resolveEffectiveChatModelBinding(chat);
      await dispatchSendMessageAndAwaitIdle({
        chatId: chat.id,
        text: `/${GIT_SETUP_SKILL_ID} ${userText}`,
        historyContent,
        displayText,
        skillId: GIT_SETUP_SKILL_ID,
        modelId: binding.modelId || chat.modelId,
        providerId: binding.providerId || chat.providerId,
      });
      return;
    }
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

/** Ensure the tool server is up before a git skill turn; surfaces status on failure. */
async function ensureToolServerForGitSetup(): Promise<boolean> {
  const serverUp = await detectLocalServer();
  if (!serverUp) {
    setStatus('err', 'Tool server required for git setup — run npm start');
  }
  return serverUp;
}

/**
 * Git preflight → optional skill turn → board_init kickoff.
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
        await runGitSetupSkillTurn(chat, 'init');
        if (kickoffAborted()) return;
        gitStatus = await getWorkspaceGitStatus(getWorkspacePath());
      }
    }

    if (gitStatus.isGitRepo && !gitStatus.hasRemote) {
      const remoteAccepted = await promptBoardGitSetup('remote');
      if (kickoffAborted()) return;

      if (remoteAccepted) {
        if (!(await ensureToolServerForGitSetup())) return;
        await runGitSetupSkillTurn(chat, 'remote');
        if (kickoffAborted()) return;
      }
    }

    sendBoardMessage(BOARD_ONBOARDING_KICKOFF_MESSAGE);
  } finally {
    setBoardKickoffInProgress(false);
    refreshBoardOnboardingIfMounted();
  }
}
