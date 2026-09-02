import { PLACEHOLDER_CHAT_NAME } from '../../constants';

/** True when the chat still uses the default untitled name (case-insensitive). */
export function isPlaceholderChatName(name: string): boolean {
  return name.trim().toLowerCase() === PLACEHOLDER_CHAT_NAME.toLowerCase();
}
