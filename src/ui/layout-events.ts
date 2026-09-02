export const CHAT_SIDEBAR_CHANGED_EVENT = 'minnow:chat-sidebar-changed';

export function emitChatSidebarChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new window.CustomEvent(CHAT_SIDEBAR_CHANGED_EVENT));
}
