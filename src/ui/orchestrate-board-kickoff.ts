/**
 * Orchestrate board kickoff: git preflight, optional /git-setup skill, then board_init message.
 */

import { formatHistoryWithSkillTag } from '../skills/parse-slash';
import { isWorkspaceGitRepo } from '../state/git-workspace';
import { getActiveChat } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { detectLocalServer } from '../tools/client';
import { buildHistoryUserContent, runChatTurn } from '../tools/loop';
import {
  getBoardKickoffAbortSignal,
  promptBoardGitSetup,
  setBoardKickoffInProgress,
  setBoardOnboardingGitSetupActive,
} from './orchestrate-board-onboarding-state';
import { setStatus } from './status';

/** First user turn from Board onboarding before the model runs board_init (MIN-5). */
export const BOARD_ONBOARDING_KICKOFF_MESSAGE =
  'Parse the selected plan and call board_init with each task\'s build and test spec and category. Do not start any tasks.';

/** Legacy alias for onboarding kickoff (historical transcripts / init-split detection). */
export const BOARD_BUILD_KICKOFF_MESSAGE = BOARD_ONBOARDING_KICKOFF_MESSAGE;

export const GIT_SETUP_SKILL_ID = 'git-setup';

const GIT_SETUP_USER_TEXT =
  'Initialize git in this workspace and connect a GitHub remote.';

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
async function runGitSetupSkillTurn(chat: ReturnType<typeof getActiveChat>): Promise<void> {
  const { refreshBoardOnboardingIfMounted } = await import('./orchestrate-board');
  setBoardOnboardingGitSetupActive(true);
  refreshBoardOnboardingIfMounted();
  try {
    const userText = GIT_SETUP_USER_TEXT;
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

/**
 * Git preflight → optional skill turn → board_init kickoff.
 * Entry points: hub Open board, onboarding Start, plan screen Open board.
 */
export async function kickoffOrchestrateBoardBuild(): Promise<void> {
  if (setBoardKickoffInProgress(true)) return;

  const { refreshBoardOnboardingIfMounted } = await import('./orchestrate-board');

  try {
    const chat = getActiveChat();
    const isGitRepo = await isWorkspaceGitRepo(getWorkspacePath());
    if (kickoffAborted()) return;

    if (!isGitRepo) {
      const accepted = await promptBoardGitSetup();
      if (kickoffAborted()) return;

      if (accepted) {
        const serverUp = await detectLocalServer();
        if (!serverUp) {
          setStatus('err', 'Tool server required for git setup — run npm start');
          return;
        }
        await runGitSetupSkillTurn(chat);
        if (kickoffAborted()) return;
      }
    }

    sendBoardMessage(BOARD_ONBOARDING_KICKOFF_MESSAGE);
  } finally {
    setBoardKickoffInProgress(false);
    refreshBoardOnboardingIfMounted();
  }
}
