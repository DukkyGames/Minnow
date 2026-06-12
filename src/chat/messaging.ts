/** Chat send: tool loop is the app default send path (SA-7, wired SA-11). */
import {
  buildApiMessages,
  MAX_TOOL_TURNS,
  runChatTurn,
  sendMessageWithTools,
} from '../tools/loop';
import type { ComposerSurface } from '../ui/composer-surface';

export {
  buildApiMessages,
  MAX_TOOL_TURNS,
  runChatTurn,
  sendMessageWithTools,
};
export type { ComposerSurface } from '../ui/composer-surface';
export { resendFromIndex } from './resend-from-index';
export {
  truncateChatHistory,
  updateUserMessageAt,
} from './history-truncate';
/** Non-tool send (legacy / internal). */
export { sendMessage as sendMessagePlain } from '../api/chat';

/** Send with optional composer surface override (defaults to foreground app). */
export async function sendMessage(
  composer?: Partial<ComposerSurface>,
): Promise<void> {
  return sendMessageWithTools(composer);
}
