import { sendMessage } from '../chat/messaging';
import { scrollChatIfPinned } from './chat-scroll';
import { handleSkillPickerKeydown, isSkillPickerOpen } from './skill-picker';

export {
  handleComposerPrimaryAction,
  setComposerStreamingMode,
  setSendLoading,
} from './composer-send';
export type { ComposerStreamingMode } from './composer-send';

export function autoResize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export function handleKey(e: KeyboardEvent): void {
  if (handleSkillPickerKeydown(e)) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    if (isSkillPickerOpen()) return;
    e.preventDefault();
    void sendMessage();
  }
}

/** Scroll chat to tail when pinned near bottom (legacy name for stream hot paths). */
export function scrollBottom(): void {
  scrollChatIfPinned();
}
