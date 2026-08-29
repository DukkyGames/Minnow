/**

 * Boot- and chat-switch resume for tool batches interrupted by reload (e.g. open ask_question).

 */



import { beginChatTurnSetup, endChatTurnSetup, isChatTurnSetupPending } from './chat-turn-guard';

import { findIncompleteToolBatchAtTail, chatAwaitingUserInputTool } from './incomplete-tool-batch';

import { isChatStreaming, isStreamDomVisible } from './streaming-state';

import { createSubAgentRunId } from '../agents/sub-agent-run-id';

import { getActiveChat } from '../state/sessions';

import { runChatToolBatch } from '../tools/chat-tool-batch';

import { findToolWrapInDom } from '../tools/tool-wrap-dom';

import type { Chat } from '../types';

import { getActiveChatMountElement } from '../ui/chat-mount';

import { renderToolCall } from '../ui/tool-messages';

import { isAskQuestionModalOpenForChat } from '../ui/question-cards-modal';
import { isUserPromptLocked } from '../ui/user-prompt-lock';

import { setStatus } from '../ui/status';
import { isResumeGateHeld } from './resume-gate';



const resumingChatIds = new Set<string>();



function getSelectedModelIdFromDom(): string {

  const el = document.getElementById('modelSelect') as HTMLSelectElement | null;

  return el?.value?.trim() ?? '';

}





function ensureToolWrap(

  chat: Chat,

  toolName: string,

  args: unknown,

  toolCallId: string,

): HTMLElement {

  const existing = findToolWrapInDom(toolCallId);

  if (existing) {

    return existing;

  }

  const toolWrap = renderToolCall(toolName, args);

  toolWrap.dataset.toolCallId = toolCallId;

  if (isStreamDomVisible(chat.id)) {

    getActiveChatMountElement().appendChild(toolWrap);

  }

  return toolWrap;

}



/**

 * Re-run pending tools from the tail assistant row, then continue the chat turn.

 * Returns true when a batch was found and resume started.

 */

export async function resumeIncompleteToolBatch(

  chat: Chat,

  options: { ownsGlobalStreaming?: boolean } = {},

): Promise<boolean> {

  if (typeof document === 'undefined') {

    return false;

  }

  if (isResumeGateHeld()) {

    return false;

  }

  if (isChatStreaming(chat.id) || isChatTurnSetupPending(chat.id)) {

    return false;

  }

  if (isUserPromptLocked()) {

    return false;

  }

  // ask_question is still waiting on the parked/open strip — do not re-run the tool.
  if (isAskQuestionModalOpenForChat(chat.id)) {

    return false;

  }

  if (resumingChatIds.has(chat.id)) {

    return false;

  }



  const batch = findIncompleteToolBatchAtTail(chat);

  if (!batch) {

    return false;

  }



  if (!beginChatTurnSetup(chat.id)) {

    return false;

  }



  resumingChatIds.add(chat.id);

  const parentTurnId = createSubAgentRunId();

  const resumeAbort = new AbortController();



  try {

    await runChatToolBatch({

      chat,

      toolCalls: batch.pendingToolCalls,

      signal: resumeAbort.signal,

      constrained: false,

      paintInChat: isStreamDomVisible(chat.id),

      parentTurnId,

      uiDesignerActive: false,

      uiDesignerMode: 'implement',

      livePartialText: '',

      thoughtController: null,

      syncContextUsage: () => {},

      trackHistoryPush: () => {},

      ensureToolWrap: (toolName, args, toolCallId) =>

        ensureToolWrap(chat, toolName, args, toolCallId),

    });



    endChatTurnSetup(chat.id);



    const modelId = getSelectedModelIdFromDom();

    if (!modelId) {

      setStatus('err', 'Select a model to continue this reply');

      return true;

    }



    const { runChatTurn } = await import('../tools/loop');

    await runChatTurn({

      chat,

      pushUser: false,

      rawText: '',

      userText: '',

      skillId: null,

      displayText: '',

      historyContent: '',

      validAttachments: [],

      ownsGlobalStreaming: options.ownsGlobalStreaming ?? true,

    });

    return true;

  } catch {

    endChatTurnSetup(chat.id);

    return false;

  } finally {

    resumingChatIds.delete(chat.id);

  }

}



/**
 * Whether the active chat has a tool batch the boot resume would pick up.
 *
 * Split out of `bootIncompleteToolResumeForChats` so the boot resume gate can ask
 * "is there anything here?" — and list it in the prompt — without resuming it.
 * Hydrates history for the same reason the resume does: a lazy boot leaves an empty
 * placeholder, and the tail scan would find nothing.
 */

export async function hasIncompleteToolBatchForBoot(): Promise<boolean> {

  if (typeof document === 'undefined') {

    return false;

  }

  const active = getActiveChat();

  if (!active) {

    return false;

  }

  try {

    const { ensureChatHistoryLoaded } = await import('../state/sessions');

    await ensureChatHistoryLoaded(active.id);

  } catch {

    return false;

  }

  return Boolean(findIncompleteToolBatchAtTail(active));

}



/** Resume pending tools for the active chat after reload (other chats wait until opened). */

export async function bootIncompleteToolResumeForChats(chats: readonly Chat[]): Promise<void> {

  if (!(await hasIncompleteToolBatchForBoot())) {

    return;

  }

  const active = getActiveChat();

  if (!active) {

    return;

  }

  await ensureAskQuestionSurfaceForChat(active);

  await resumeIncompleteToolBatch(active, { ownsGlobalStreaming: true });

}



/**

 * Open the desktop chat surface before resuming ask_question on reload so the strip

 * mounts in `#desktopQuestionHost` instead of a hidden Code bench host.

 */

async function ensureAskQuestionSurfaceForChat(chat: Chat): Promise<void> {

  if (!chatAwaitingUserInputTool(chat)) {

    return;

  }

  const { isOsShellEnabled } = await import('../os/page-bridge');

  if (!isOsShellEnabled()) {

    return;

  }

  if (chat.modeId !== 'desktop') {
    return;
  }

  const { launchApp } = await import('../os/router');
  launchApp('code', { chatId: chat.id });
  const { renderChatFromHistory } = await import('../ui/messages');
  renderChatFromHistory(chat);
}



/** Resume when switching to a chat that still has unanswered question cards in history. */

export async function resumeIncompleteToolBatchOnChatSwitch(chat: Chat): Promise<void> {

  if (isResumeGateHeld()) {

    return;

  }

  if (!findIncompleteToolBatchAtTail(chat)) {

    return;

  }

  if (isAskQuestionModalOpenForChat(chat.id)) {

    return;

  }

  await resumeIncompleteToolBatch(chat, { ownsGlobalStreaming: true });

}

