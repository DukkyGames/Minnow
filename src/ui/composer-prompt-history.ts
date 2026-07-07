/**
 * Per-chat composer prompt history (ArrowUp/ArrowDown), shell-style recall of prior user messages.
 */

import type { Message } from '../types';
import { stripSkillTagFromHistory } from '../skills/history-content';
import { getActiveChat } from '../state/sessions';
import { autoResizeDesktopComposer } from '../os/desktop-composer-resize';
import { resolveHistoryNavigation } from './terminal-history-nav';

let trackedChatId: string | null = null;
let historyIndex = 0;

/** Collect editable user prompts from chat history (newest last). */
export function collectChatUserPrompts(history: Message[]): string[] {
  const prompts: string[] = [];
  for (const row of history) {
    if (row.role !== 'user') continue;
    if ('goalAchieved' in row && row.goalAchieved) continue;
    const text = stripSkillTagFromHistory(row.content);
    if (!text.trim()) continue;
    prompts.push(text);
  }
  return prompts;
}

/** True when a collapsed caret sits at the start of the composer (Up may recall). */
export function isComposerCaretAtStart(input: HTMLTextAreaElement): boolean {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  return start === end && start === 0;
}

/** True when a collapsed caret sits at the end of the composer (Down may advance). */
export function isComposerCaretAtEnd(input: HTMLTextAreaElement): boolean {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const len = input.value.length;
  return start === end && start === len;
}

function resizeComposerInput(input: HTMLTextAreaElement): void {
  if (input.id === 'desktopInput') {
    autoResizeDesktopComposer(input);
    return;
  }
  if (input.id === 'chatAppInput') {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    return;
  }
  void import('./input').then((m) => m.autoResize(input));
}

function applyRecalledPrompt(input: HTMLTextAreaElement, text: string): void {
  input.value = text;
  const caret = text.length;
  input.selectionStart = caret;
  input.selectionEnd = caret;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  resizeComposerInput(input);
}

function syncChatScope(chatId: string, promptCount: number): void {
  if (trackedChatId !== chatId) {
    trackedChatId = chatId;
    historyIndex = promptCount;
  }
}

/** Snap recall position to the draft tail after send or composer clear. */
export function resetComposerPromptHistory(chatId?: string): void {
  const chat = getActiveChat();
  const id = chatId ?? chat.id;
  const prompts = collectChatUserPrompts(chat.history);
  trackedChatId = id;
  historyIndex = prompts.length;
}

/** @internal Reset module state between happy-dom test runs. */
export function __resetComposerPromptHistoryForTests(): void {
  trackedChatId = null;
  historyIndex = 0;
}

/**
 * Navigate prior user prompts when ArrowUp/Down are pressed at the composer edges.
 * Returns true when the key was consumed.
 */
export function handleComposerPromptHistoryKeydown(
  e: KeyboardEvent,
  input: HTMLTextAreaElement,
): boolean {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.shiftKey) return false;

  const chat = getActiveChat();
  const prompts = collectChatUserPrompts(chat.history);
  if (prompts.length === 0) return false;

  syncChatScope(chat.id, prompts.length);

  if (e.key === 'ArrowUp' && !isComposerCaretAtStart(input)) return false;
  if (e.key === 'ArrowDown' && !isComposerCaretAtEnd(input)) return false;

  const arrow = e.key === 'ArrowUp' ? 'up' : 'down';
  const nav = resolveHistoryNavigation({ historyIndex, tabHistory: prompts }, arrow);
  historyIndex = nav.historyIndex;

  e.preventDefault();
  applyRecalledPrompt(input, nav.nextLine);
  return true;
}
