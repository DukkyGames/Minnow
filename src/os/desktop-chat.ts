/**
 * Desktop chat surface — sessions, transcript, and composer send on the OS desktop.
 */

import { notifyAskQuestionDisplayContextChanged } from '../chat/ask-question-display';
import { resumeIncompleteToolBatchOnChatSwitch } from '../chat/incomplete-tool-resume';
import { sendMessage } from '../chat/messaging';
import { isActiveChatBusy, subscribeChatStreamEnd } from '../chat/streaming-state';
import { getDesktopWorkspacePath } from '../lib/desktop-workspace';
import {
  DESKTOP_APP_ID,
  createDesktopChat,
  ensureActiveDesktopAssistantChat,
} from './desktop-chat-sessions';
import { getWorkspacePath } from '../state/workspace';
import type { DesktopChatActivateOptions } from './desktop-state';
import {
  ensureChatHistoryLoaded,
  ensureSessionsReady,
  getActiveChat,
  isEphemeralEmptyChat,
  isExpertChat,
  markSessionScalarsDirty,
  newChatId,
  touchChat,
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
  shouldAllowComposerPrimaryAction,
  syncComposerFromStreamingState,
} from '../ui/composer-send';
import { initComposerDraftListener, switchComposerDraft } from '../ui/composer-draft';
import { initComposerSlashPicker } from '../ui/skill-picker';
import { refreshContextUsageRing } from '../ui/context-usage-ring';
import { clearPanelCwdUserOverride, syncPanelFromActiveChat } from '../ui/git-panel';
import { seedNewChatComposerRunTarget } from '../ui/new-chat-run-target-seed';
import { renderChatFromHistory } from '../ui/messages';
import { syncAskQuestionModalOnChatSwitch } from '../ui/question-cards-modal';
import { setStatus } from '../ui/status';
import type { Chat } from '../types';
import { isDesktopChatActive } from './desktop-state';
import { renderDesktopChatRail } from '../ui/desktop-chat-rail';
import { autoResizeDesktopComposer } from './desktop-composer-resize';

export { autoResizeDesktopComposer, DESKTOP_COMPOSER_MAX_LINES } from './desktop-composer-resize';

const DESKTOP_CHAT_MOUNT = '#desktopChatCol';

let desktopWorkspacePath: string | null = null;
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
    <p>Ask anything — use the Files, Browser, and Preview tabs on the right for workspace files.</p>
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
    void import('../ui/loop-active-hint').then(({ syncLoopStatusUi }) => {
      syncLoopStatusUi(chat.id);
    });
    return;
  }

  renderChatFromHistory(chat, DESKTOP_CHAT_MOUNT);
}

function syncDesktopComposerSendState(): void {
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById('desktopSendBtn') as HTMLButtonElement | null;
  if (!sendBtn) return;
  sendBtn.disabled = !shouldAllowComposerPrimaryAction(input?.value ?? '');
}

async function ensureDesktopWorkspaceReady(): Promise<boolean> {
  desktopWorkspacePath = await getDesktopWorkspacePath();
  return Boolean(desktopWorkspacePath);
}

async function ensureReadyForSend(): Promise<boolean> {
  try {
    const chat = getActiveChat();
    // Only bootstrap a sandbox chat when nothing is active yet — do not replace a
    // branched (or other in-progress) project chat after branch switching.
    if (!isExpertChat(chat) && isEphemeralEmptyChat(chat)) {
      await ensureActiveDesktopAssistantChat();
    }
    if (!desktopWorkspacePath) {
      desktopWorkspacePath = await getDesktopWorkspacePath();
    }
    return true;
  } catch {
    setStatus('err', 'Desktop workspace unavailable — run npm start');
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

  if (isActiveChatBusy()) {
    handleComposerPrimaryAction();
    syncDesktopComposerSendState();
    return;
  }

  const sendBtn = document.getElementById('desktopSendBtn') as HTMLButtonElement | null;
  await sendMessage({ inputEl: input, sendBtnEl: sendBtn });
  renderDesktopChatMessages();
  renderDesktopChatRail(desktopWorkspacePath);
  syncDesktopComposerSendState();
  refreshContextUsageRing();
}

async function applyDesktopSeed(seed?: string): Promise<void> {
  if (!seed?.trim() || !sessionState) return;
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  if (!input || input.value.trim()) return;
  await handleDesktopSend(seed.trim());
}

/** Start a fresh assistant thread in the desktop workspace sandbox. */
function createFreshAssistantChat(
  workspacePath: string,
  state: NonNullable<typeof sessionState>,
): void {
  const chat = createDesktopChat(workspacePath, newChatId());
  seedNewChatComposerRunTarget(chat);
  state.chats.unshift(chat);
  state.activeId = chat.id;
  touchChat(chat);
  markSessionScalarsDirty();
  clearPanelCwdUserOverride();
  syncPanelFromActiveChat({ forceFileTree: true });
  rememberActiveChatForApp(DESKTOP_APP_ID, chat.id);
  scheduleSaveSessions({ chatId: chat.id });
}

/**
 * Park/unpark ask_question UI and resume incomplete tool batches when the desktop
 * session rail switches chats (mirrors sidebar `switchChat` hooks).
 */
export function syncDesktopChatSessionSwitch(
  prevChatId: string | null | undefined,
  chat: Chat,
): void {
  syncAskQuestionModalOnChatSwitch(prevChatId, chat.id);
  notifyAskQuestionDisplayContextChanged();
  void resumeIncompleteToolBatchOnChatSwitch(chat);
}

/** Switch the active assistant thread on the desktop surface. */
export async function activateDesktopChatSession(chatId: string): Promise<void> {
  if (!sessionState) return;
  const prevId = sessionState.activeId;
  const chat = sessionState.chats.find((c) => c.id === chatId);
  if (!chat) return;
  if (chatId === prevId) {
    // Re-hydrate in case this chat was never loaded after a lazy boot.
    await ensureChatHistoryLoaded(chatId);
    if (!sessionState || sessionState.activeId !== chatId) return;
    acknowledgeChatViewed(chatId);
    renderDesktopChatRail(desktopWorkspacePath);
    renderDesktopChatMessages();
    syncChatItemDotsInDom();
    syncDesktopComposerSendState();
    refreshContextUsageRing();
    void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chatId));
    return;
  }
  sessionState.activeId = chatId;
  markSessionScalarsDirty();
  // Lazy history: wait before paint so restart+switch does not show empty state.
  await ensureChatHistoryLoaded(chatId);
  if (!sessionState || sessionState.activeId !== chatId) return;
  syncDesktopChatSessionSwitch(prevId, chat);
  clearPanelCwdUserOverride();
  syncPanelFromActiveChat({ forceFileTree: true });
  acknowledgeChatViewed(chatId);
  void switchComposerDraft(prevId, chat);
  renderDesktopChatRail(desktopWorkspacePath);
  renderDesktopChatMessages();
  syncChatItemDotsInDom();
  syncDesktopComposerSendState();
  refreshContextUsageRing();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chatId));
}

function onChatStreamEnded(chatId: string): void {
  if (!isDesktopChatActive()) return;
  renderDesktopChatRail(desktopWorkspacePath);
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

  await ensureSessionsReady();

  const ready = await ensureDesktopWorkspaceReady();
  if (ready && sessionState) {
    rememberWorkspaceActiveChat(getWorkspacePath());

    const state = sessionState;
    if (options?.chatId?.trim()) {
      try {
        const chat = state.chats.find((c) => c.id === options.chatId?.trim());
        if (chat) {
          state.activeId = chat.id;
          markSessionScalarsDirty();
          acknowledgeChatViewed(chat.id);
        } else {
          await ensureActiveDesktopAssistantChat();
        }
      } catch {
        /* server offline — still show shell */
      }
    } else if (options?.seed?.trim() && desktopWorkspacePath) {
      // Seeded sends from the hero concierge always open a new thread.
      createFreshAssistantChat(desktopWorkspacePath, state);
    } else {
      try {
        await ensureActiveDesktopAssistantChat();
      } catch {
        /* server offline — still show shell */
      }
    }
    // Lazy history: hydrate the active desktop thread before the first paint.
    if (state.activeId) {
      await ensureChatHistoryLoaded(state.activeId);
    }
  }

  renderDesktopChatRail(desktopWorkspacePath);
  renderDesktopChatMessages();
  syncDesktopComposerSendState();
  if (sessionState) {
    syncComposerFromStreamingState();
    refreshChatJumpChipVisibility();
    syncChatItemDotsInDom();
  }
  refreshContextUsageRing();

  await applyDesktopSeed(options?.seed);

  try {
    void resumeIncompleteToolBatchOnChatSwitch(getActiveChat());
  } catch {
    /* server offline */
  }

  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  input?.focus();
}

export function wireDesktopComposerControls(inputEl?: HTMLTextAreaElement | null): void {
  const input =
    inputEl ?? (document.getElementById('desktopInput') as HTMLTextAreaElement | null);
  if (!input || input.dataset.desktopComposerBound === '1') return;
  input.dataset.desktopComposerBound = '1';

  initComposerSteerInputListener(input);
  initComposerDraftListener(input);
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
