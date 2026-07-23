/** Chat send: tool loop is the app default send path (SA-7, wired SA-11). */
import {
  buildApiMessages,
  runChatTurn,
  sendMessageWithTools,
  type ComposerSendOptions,
} from '../tools/loop';

export {
  buildApiMessages,
  runChatTurn,
  sendMessageWithTools,
};
export type { ComposerSurface } from '../ui/composer-surface';
export type { ComposerSendOptions } from '../tools/loop';
export { resendFromIndex } from './resend-from-index';
export {
  truncateChatHistory,
  updateUserMessageAt,
} from './history-truncate';
/** Non-tool send (legacy / internal). */
export { sendMessage as sendMessagePlain } from '../api/chat';

/** Send with optional composer surface override (defaults to foreground app). */
export async function sendMessage(
  composer?: ComposerSendOptions,
): Promise<void> {
  return sendMessageWithTools(composer);
}
