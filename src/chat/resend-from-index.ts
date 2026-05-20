/**
 * Replay the assistant turn from an existing user message (no duplicate user row).
 */

import { streaming } from '../app-state';
import { clearAttachments } from '../attachments/store';
import { parseSlashCommand } from '../skills/parse-slash';
import { parseSkillTagFromHistory } from '../skills/history-content';
import { findChatById, getActiveChat } from '../state/sessions';
import { runChatTurn } from '../tools/loop';
import { truncateChatHistory } from './history-truncate';
import { renderChatFromHistory } from '../ui/messages';
import { setStatus } from '../ui/status';

/** Resend from a user history index (truncate after, then run tool loop). */
export async function resendFromIndex(
  chatId: string,
  userHistoryIndex: number,
): Promise<void> {
  if (streaming) {
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

  if (
    !Number.isInteger(userHistoryIndex) ||
    userHistoryIndex < 0 ||
    userHistoryIndex >= chat.history.length
  ) {
    setStatus('err', 'Invalid message');
    return;
  }

  const row = chat.history[userHistoryIndex];
  if (row.role !== 'user') {
    setStatus('err', 'Can only resend from a user message');
    return;
  }

  const truncated = truncateChatHistory(chatId, userHistoryIndex, 'inclusive');
  if (!truncated.ok) {
    if (truncated.error === 'streaming') {
      setStatus('spin', 'Finish or stop the current reply first');
    } else {
      setStatus('err', 'Could not update history');
    }
    return;
  }

  const active = truncated.chat ?? chat;
  const userRow = active.history[userHistoryIndex];
  if (!userRow || userRow.role !== 'user') {
    setStatus('err', 'User message missing after truncate');
    return;
  }

  clearAttachments();
  renderChatFromHistory(active);

  const tagged = parseSkillTagFromHistory(userRow.content);
  const slash = parseSlashCommand(tagged.displayText);
  const skillId = tagged.skillId ?? slash.skillId;
  const userText = slash.userText || tagged.displayText;

  await runChatTurn({
    chat: active,
    pushUser: false,
    rawText: tagged.displayText,
    userText,
    skillId,
    displayText: userRow.content,
    historyContent: userRow.content,
    validAttachments: [],
    shouldScheduleTitle: false,
  });
}
