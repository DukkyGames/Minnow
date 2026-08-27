/**
 * Failed-turn recovery (MIN-666): Continue retries with full history;
 * Clear drops only the failed assistant output and keeps the user prompt.
 */

import { parseSkillTagFromHistory } from '../skills/history-content';
import { parseSlashCommand } from '../skills/parse-slash';
import { isChatStreaming } from './streaming-state';
import {
  ensureChatHistoryLoaded,
  findChatById,
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { resolveFailedTurnContinueInstruction } from '../tools/turn-continuation';
import { runChatTurn } from '../tools/loop';
import { setStatus } from '../ui/status';
import { clearFailedAssistantOutput } from './history';
import { indexOfLastUserMessage } from './history-truncate-core';

/** Replay the failed turn without truncating the visible transcript. */
export async function continueFailedTurn(chatId: string): Promise<void> {
  if (isChatStreaming(chatId)) {
    setStatus('spin', 'Finish or stop the current reply first');
    return;
  }

  const chat =
    findChatById(chatId) ??
    (getActiveChat().id === chatId ? getActiveChat() : undefined);
  if (!chat) {
    setStatus('err', 'Chat not found');
    return;
  }

  /*
   * Absolute indices and outbound replay both need the full transcript.
   * Continue after a lazy boot used to send an empty placeholder (MIN-641).
   */
  try {
    await ensureChatHistoryLoaded(chatId);
  } catch {
    setStatus('err', 'Could not load this chat’s messages');
    return;
  }

  const lastUserIndex = indexOfLastUserMessage(chat.history);
  const last = chat.history[chat.history.length - 1];
  const lastIsUser = last?.role === 'user';

  // Unanswered prompt: reuse the last user row. Failed assistant: keep it in
  // context and send an ephemeral continue line (not stored in history).
  let skillId: string | null = null;
  let rawText = '';
  let userText = '';
  let displayText = '';
  let historyContent = '';
  if (lastIsUser && lastUserIndex >= 0) {
    const userRow = chat.history[lastUserIndex];
    if (userRow?.role === 'user') {
      const tagged = parseSkillTagFromHistory(userRow.content);
      const slash = parseSlashCommand(tagged.displayText);
      skillId = tagged.skillId ?? slash.skillId;
      rawText = tagged.displayText;
      userText = slash.userText || tagged.displayText;
      displayText = userRow.content;
      historyContent = userRow.content;
    }
  }

  await runChatTurn({
    chat,
    pushUser: false,
    rawText,
    userText,
    skillId,
    displayText,
    historyContent,
    validAttachments: [],
    shouldScheduleTitle: false,
    ephemeralContinueInstruction: resolveFailedTurnContinueInstruction(chat.history),
    ownsGlobalStreaming: true,
  });
}

/** Remove the failed assistant output only; do not resend and do not drop the user prompt. */
export async function clearFailedAssistantTurn(
  chatId: string,
  forkHistoryIndex: number,
): Promise<void> {
  if (isChatStreaming(chatId)) {
    setStatus('spin', 'Finish or stop the current reply first');
    return;
  }

  const chat =
    findChatById(chatId) ??
    (getActiveChat().id === chatId ? getActiveChat() : undefined);
  if (!chat) {
    setStatus('err', 'Chat not found');
    return;
  }

  try {
    await ensureChatHistoryLoaded(chatId);
  } catch {
    setStatus('err', 'Could not load this chat’s messages');
    return;
  }

  const changed = clearFailedAssistantOutput(chat, forkHistoryIndex);
  if (changed) {
    touchChat(chat);
    scheduleSaveSessions();
  }

  // Re-render even when history was unchanged so a UI-only error bubble goes away.
  const { renderChatFromHistory } = await import('../ui/messages');
  renderChatFromHistory(chat);
}
