import { sendMessage } from '../chat/messaging';
import { handleSkillPickerKeydown, isSkillPickerOpen } from './skill-picker';

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

export function scrollBottom(): void {
  const area = document.getElementById('chatArea')!;
  area.scrollTop = area.scrollHeight;
}

export function setSendLoading(loading: boolean): void {
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  sendBtn.disabled = loading;
  sendBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  document.getElementById('sendIcon')!.classList.toggle('hidden', loading);
  document.getElementById('sendSpinner')!.classList.toggle('hidden', !loading);
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (input) input.disabled = loading;
}
