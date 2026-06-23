/**
 * Desktop chat surface — sessions, transcript, and composer send on the OS desktop.
 */

import { sendMessage } from '../chat/messaging';
import { isActiveChatStreaming, subscribeChatStreamEnd } from '../chat/streaming-state';
import { getChatsWorkspacePath } from '../lib/chats-workspace';
import { getWorkspacePath } from '../state/workspace';
import type { DesktopChatActivateOptions } from './desktop-state';
import {
  CHAT_APP_ID,
  createAssistantChat,
  ensureActiveAssistantChat,
} from '../state/chat-app-sessions';
import {
  getActiveChat,
  isExpertChat,
  newChatId,
  rememberActiveChatForApp,
  rememberWorkspaceActiveChat,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import { refreshChatJumpChipVisibility } from '../ui/chat-scroll';
import { syncChatItemDotsInDom } from '../ui/chat-item-dot';
import { acknowledgeChatViewed } from '../notifications/acknowledge';
import {
  handleComposerPrimaryAction,
  initComposerSteerInputListener,
  syncComposerFromStreamingState,
} from '../ui/composer-send';
import { initComposerSlashPicker } from '../ui/skill-picker';
import { refreshContextUsageRing } from '../ui/context-usage-ring';
import { renderChatFromHistory } from '../ui/messages';
import { setStatus } from '../ui/status';
import { isDesktopChatActive } from './desktop-state';
import { renderDesktopChatRail } from '../ui/desktop-chat-rail';
import { autoResizeDesktopComposer } from './desktop-composer-resize';

export { autoResizeDesktopComposer, DESKTOP_COMPOSER_MAX_LINES } from './desktop-composer-resize';

const DESKTOP_CHAT_MOUNT = '#desktopChatCol';

let chatsWorkspacePath: string | null = null;
let streamEndBound = false;

function getTranscriptCol(): HTMLElement | null {
  return document.getElementById('desktopChatCol');
}

function getTranscriptScroll(): HTMLElement | null {
  return document.querySelector('.mn-os-chat-transcript');
}

function renderDesktopEmptyState(area: HTMLElement): void {
  area.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'mn-os-chat-empty';
  empty.innerHTML = `
    <div class="mn-os-chat-empty-ico" aria-hidden="true">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </div>
    <h2>Start a conversation</h2>
    <p>Ask anything — tools and file outputs work here too.</p>
  `;
  area.appendChild(empty);
}

/** Paint transcript for the active assistant chat. */
export function renderDesktopChatMessages(): void {
  if (!sessionState) return;
  const chat = getActiveChat();
  const col = getTranscriptCol();
  if (!col) return;

  if (!chat.history.length) {
    renderDesktopEmptyState(col);
    return;
  }

  renderChatFromHistory(chat, DESKTOP_CHAT_MOUNT);
}

function syncDesktopComposerSendState(): void {
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById('desktopSendBtn') as HTMLButtonElement | null;
  if (!sendBtn) return;
  if (isActiveChatStreaming()) {
    sendBtn.disabled = false;
    return;
  }
  sendBtn.disabled = !input?.value.trim();
}

async function ensureChatsWorkspaceReady(): Promise<boolean> {
  chatsWorkspacePath = await getChatsWorkspacePath();
  return Boolean(chatsWorkspacePath);
}

async function ensureReadyForSend(): Promise<boolean> {
  try {
    const chat = getActiveChat();
    if (!isExpertChat(chat)) {
      await ensureActiveAssistantChat();
    }
    if (!chatsWorkspacePath) {
      chatsWorkspacePath = await getChatsWorkspacePath();
    }
    return true;
  } catch {
    setStatus('err', 'Chats workspace unavailable — run npm start');
    return false;
  }
}

/** Send from the desktop composer (chat active). */
export async function handleDesktopSend(prefill?: string): Promise<void> {
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  if (prefill?.trim() && input && !input.value.trim()) {
    input.value = prefill.trim();
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    syncDesktopComposerSendState();
  }

  if (!(await ensureReadyForSend())) return;

  if (isActiveChatStreaming()) {
    handleComposerPrimaryAction();
    syncDesktopComposerSendState();
    return;
  }

  const sendBtn = document.getElementById('desktopSendBtn') as HTMLButtonElement | null;
  await sendMessage({ inputEl: input, sendBtnEl: sendBtn });
  renderDesktopChatMessages();
  renderDesktopChatRail(chatsWorkspacePath);
  syncDesktopComposerSendState();
  refreshContextUsageRing();
}

async function applyDesktopSeed(seed?: string): Promise<void> {
  if (!seed?.trim() || !sessionState) return;
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  if (!input || input.value.trim()) return;
  await handleDesktopSend(seed.trim());
}

/** Start a fresh assistant thread in the chats workspace sandbox. */
function createFreshAssistantChat(
  chatsWorkspacePath: string,
  state: NonNullable<typeof sessionState>,
): void {
  const chat = createAssistantChat(chatsWorkspacePath, newChatId());
  state.chats.unshift(chat);
  state.activeId = chat.id;
  rememberActiveChatForApp(CHAT_APP_ID, chat.id);
  scheduleSaveSessions();
}

/** Switch the active assistant thread on the desktop surface. */
export function activateDesktopChatSession(chatId: string): void {
  if (!sessionState) return;
  const chat = sessionState.chats.find((c) => c.id === chatId);
  if (!chat) return;
  sessionState.activeId = chatId;
  acknowledgeChatViewed(chatId);
  renderDesktopChatRail(chatsWorkspacePath);
  renderDesktopChatMessages();
  syncChatItemDotsInDom();
  syncDesktopComposerSendState();
  refreshContextUsageRing();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chatId));
}

function onChatStreamEnded(chatId: string): void {
  if (!isDesktopChatActive()) return;
  renderDesktopChatRail(chatsWorkspacePath);
  if (getActiveChat().id === chatId) {
    renderDesktopChatMessages();
    syncDesktopComposerSendState();
    syncComposerFromStreamingState();
  }
}

function bindStreamEndOnce(): void {
  if (streamEndBound) return;
  streamEndBound = true;
  subscribeChatStreamEnd((chatId) => onChatStreamEnded(chatId));
}

/** Activate assistant chat, render rail + transcript, optional seed auto-send. */
export async function bootstrapDesktopChat(options?: DesktopChatActivateOptions): Promise<void> {
  bindStreamEndOnce();

  const ready = await ensureChatsWorkspaceReady();
  if (ready && sessionState) {
    rememberWorkspaceActiveChat(getWorkspacePath());

    const state = sessionState;
    if (options?.chatId?.trim()) {
      try {
        const chat = state.chats.find((c) => c.id === options.chatId?.trim());
        if (chat) {
          state.activeId = chat.id;
          acknowledgeChatViewed(chat.id);
          if (isExpertChat(chat)) {
            const expertId =
              chat.expertId?.trim() || chat.expertSelection?.expertId?.trim() || '';
            if (expertId) {
              const scope = await import('../ui/experts/experts-scope');
              scope.setExpertScopeId(expertId);
              scope.syncExpertScopeChromeDataset();
              scope.setExpertScopeSidebarVisible(true);
              scope.renderExpertScopeHeader(expertId);
            }
          }
        } else {
          await ensureActiveAssistantChat();
        }
      } catch {
        /* server offline — still show shell */
      }
    } else if (options?.seed?.trim() && chatsWorkspacePath) {
      // Seeded sends from the hero concierge always open a new thread.
      createFreshAssistantChat(chatsWorkspacePath, state);
    } else {
      try {
        await ensureActiveAssistantChat();
      } catch {
        /* server offline — still show shell */
      }
    }
  }

  renderDesktopChatRail(chatsWorkspacePath);
  renderDesktopChatMessages();
  syncDesktopComposerSendState();
  if (sessionState) {
    syncComposerFromStreamingState();
    refreshChatJumpChipVisibility();
    syncChatItemDotsInDom();
  }
  refreshContextUsageRing();

  await applyDesktopSeed(options?.seed);

  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  input?.focus();
}

export function wireDesktopComposerControls(inputEl?: HTMLTextAreaElement | null): void {
  const input =
    inputEl ?? (document.getElementById('desktopInput') as HTMLTextAreaElement | null);
  if (!input || input.dataset.desktopComposerBound === '1') return;
  input.dataset.desktopComposerBound = '1';

  initComposerSteerInputListener(input);
  initComposerSlashPicker(input);
  const onInput = (): void => {
    autoResizeDesktopComposer(input);
    syncDesktopComposerSendState();
  };
  input.addEventListener('input', onInput);
  window.addEventListener('resize', () => autoResizeDesktopComposer(input));
  requestAnimationFrame(() => autoResizeDesktopComposer(input));
  const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
  document.getElementById('btnDesktopAttach')?.addEventListener('click', () => {
    fileInput?.click();
  });

  void import('../ui/context-usage-ring').then((m) => m.bindContextUsageRings());
  void import('../ui/composer-voice').then((m) => m.initComposerVoice());
}

/** Scroll transcript container when jump chip is used. */
export function getDesktopChatScrollElement(): HTMLElement | null {
  return getTranscriptScroll();
}
