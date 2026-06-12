/**
 * Refcount lock that keeps the composer disabled while tool approval or ask_question UI is open.
 * Prevents click-through on Send/Stop between sequential prompts (e.g. tool approval → allowlist cards).
 */

import { syncComposerFromStreamingState } from './composer-send';

let lockDepth = 0;

/** True while any user-prompt strip (approval or question cards) is active. */
export function isUserPromptLocked(): boolean {
  return lockDepth > 0;
}

/** Disable composer controls until the matching {@link releaseUserPromptLock}. */
export function acquireUserPromptLock(): void {
  lockDepth += 1;
  applyUserPromptLock();
}

/** Re-enable composer when the last prompt strip closes. */
export function releaseUserPromptLock(): void {
  lockDepth = Math.max(0, lockDepth - 1);
  applyUserPromptLock();
}

/** Reset lock state (tests). */
export function resetUserPromptLockForTests(): void {
  lockDepth = 0;
  applyUserPromptLock();
}

function applyUserPromptLock(): void {
  const locked = lockDepth > 0;
  const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
  const chatInput = document.getElementById('chatAppInput') as HTMLTextAreaElement | null;
  const chatSendBtn = document.getElementById('chatAppSendBtn') as HTMLButtonElement | null;
  const chatStopBtn = document.getElementById('btnChatAppStop') as HTMLButtonElement | null;
  if (locked) {
    if (msgInput) msgInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (chatInput) chatInput.disabled = true;
    if (chatSendBtn) chatSendBtn.disabled = true;
    if (chatStopBtn) chatStopBtn.disabled = true;
    return;
  }
  syncComposerFromStreamingState();
}
