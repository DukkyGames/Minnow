import type { Chat } from '../../types';
import type { UiDesignerMode } from './constants';

const MODE_RE = /^(plan|implement)\b/i;

export function parseUiDesignerMode(
  userText: string,
  chat?: Pick<Chat, 'uiDesignerMode'>,
): UiDesignerMode {
  const trimmed = userText.trim();
  const match = trimmed.match(MODE_RE);
  if (match) {
    return match[1].toLowerCase() === 'implement' ? 'implement' : 'plan';
  }
  if (chat?.uiDesignerMode === 'implement') return 'implement';
  return 'plan';
}

export function stripUiDesignerModePrefix(userText: string): string {
  return userText.replace(MODE_RE, '').trim();
}
