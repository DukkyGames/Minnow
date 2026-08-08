/**
 * Shared layout event names.
 *
 * Kept in its own module so the OS shell can listen for chat-sidebar changes
 * without importing `layout.ts` (which pulls in session state) at module load.
 */

/** Fired on `window` whenever the chat sidebar's open/collapsed state settles. */
export const CHAT_SIDEBAR_CHANGED_EVENT = 'minnow:chat-sidebar-changed';

export function emitChatSidebarChanged(): void {
  window.dispatchEvent(new window.CustomEvent(CHAT_SIDEBAR_CHANGED_EVENT));
}
