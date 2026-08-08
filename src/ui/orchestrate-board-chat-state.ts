/**
 * Which board chat is open inside the Orchestrate main pane.
 *
 * Deliberately a leaf module with no imports: `sidebar.ts`, `messages.ts` and
 * `chat-scroll.ts` all need to read this state, and routing it through
 * `orchestrate-board-chat.ts` (which imports all three) would build a cycle.
 *
 * Board chats are not listed in the chats panel, so "open" here means the chat
 * is showing in `.ob-main` in place of the board, not that it owns `#chatArea`.
 */

/** Marks the transcript host so `isCodeChatMount` keeps Code chat behaviour. */
export const ORCHESTRATE_CHAT_PANE_TESTID = 'orchestrate-chat-pane';

/** Scroll container for the embedded transcript (see chat-scroll.ts). */
export const OB_CHAT_SCROLL_SELECTOR = '.ob-chat__scroll';

let openChatId: string | null = null;

/** Chat currently showing in `.ob-main`, or null when the board is showing. */
export function getOpenBoardChatId(): string | null {
  return openChatId;
}

/** Record (or clear) the board chat showing in `.ob-main`. */
export function setOpenBoardChatId(chatId: string | null): void {
  openChatId = chatId?.trim() || null;
}

/** True while a board chat is showing in place of the board. */
export function isBoardChatEmbedOpen(): boolean {
  return openChatId != null;
}

/** True when the embed is showing this specific chat. */
export function isBoardChatEmbedOpenForChat(chatId: string): boolean {
  return openChatId != null && openChatId === chatId;
}

/**
 * Transcript element inside the open `.ob-chat`, or null when the board shows.
 * Lives here (not in orchestrate-board-chat.ts) so `messages.ts` can resolve the
 * mount without importing the module that imports it back.
 */
export function queryBoardChatTranscriptHost(): HTMLElement | null {
  const host = document.querySelector('.ob-chat .ob-chat__transcript');
  return host instanceof HTMLElement ? host : null;
}
