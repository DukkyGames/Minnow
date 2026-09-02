import { renderAttachPreview } from '../../attachments/store';
import { notifyAskQuestionDisplayContextChanged } from '../../chat/ask-question-display';
import { resumeIncompleteToolBatchOnChatSwitch } from '../../chat/incomplete-tool-resume';
import { sendMessage } from '../../chat/messaging';
import {
  isActiveChatStreaming,
  subscribeChatStreamEnd,
} from '../../chat/streaming-state';
import { stopGeneration } from '../../chat/stop-generation';
import { PLACEHOLDER_CHAT_NAME } from '../../constants';
import type { EmailAccount } from '../../email/client';
import { fetchInboxSummary } from '../../email/client-ext';
import { createModeMaskIcon } from '../mode-icons';
import { iconHtml } from '../icon';
import {
  activateChatById,
  createEmailAssistantChatForApp,
  getActiveChat,
  getEmailAssistantChats,
  scheduleSaveSessions,
  sessionState,
} from '../../state/sessions';
import { ensureActiveEmailAssistantChat } from '../../state/email-chat-sessions';
import type { Chat } from '../../types';
import { registerComposerSurface } from '../composer-surface';
import {
  initComposerDraftListener,
  switchComposerDraft,
} from '../composer-draft';
import { initComposerDrop } from '../composer-drop';
import { initComposerPaste } from '../composer-paste';
import { handleComposerPromptHistoryKeydown } from '../composer-prompt-history';
import {
  initComposerSteerInputListener,
  shouldAllowComposerPrimaryAction,
  syncComposerFromStreamingState,
} from '../composer-send';
import { renderChatFromHistory } from '../messages';
import { syncAskQuestionModalOnChatSwitch } from '../question-cards-modal';
import {
  handleSkillPickerKeydown,
  initComposerSlashPicker,
  isSkillPickerOpen,
} from '../skill-picker';
import { renderPendingActions, type EmailDashboardOptions } from './email-dashboard';
import {
  buildEmailAssistantContextPrompt,
  formatEmailAssistantContextLabel,
  sanitizeEmailAssistantContext,
  type EmailAssistantContextSnapshot,
} from './email-assistant-context';
import { EMAIL_ICONS } from './email-icons';
import {
  disposeEmailAssistantDockResizer,
  mountEmailAssistantDockResizer,
  syncEmailAssistantDockResizer,
} from './email-panel-resize';

export interface EmailAssistantPanelOptions {
  account: EmailAccount | null;
  context: EmailAssistantContextSnapshot;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  /** Refresh the inbox after a review action changes mail state. */
  onMailRefresh?: () => void;
}

export interface EmailAssistantPanelController {
  open: () => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
  /** Mount the open toggle beside the inbox readout; pass null to detach. */
  mountToggle: (container: HTMLElement | null) => void;
  setAccount: (account: EmailAccount | null) => void;
  setContext: (context: EmailAssistantContextSnapshot) => void;
  refreshReview: () => Promise<void>;
  dispose: () => void;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(
  markup: string,
  label: string,
  className = 'email-assistant-icon-btn',
): HTMLButtonElement {
  const button = el('button', className) as HTMLButtonElement;
  button.type = 'button';
  button.innerHTML = markup;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

// ── Composer ─────────────────────────────────────────────────────────────────

/** Resize a compact composer without animating its layout. */
function resizeComposer(input: HTMLTextAreaElement): void {
  input.style.height = '0px';
  input.style.height = `${Math.max(42, Math.min(input.scrollHeight, 152))}px`;
  input.style.overflowY = input.scrollHeight > 152 ? 'auto' : 'hidden';
}

/** Human history label for an untitled or draft-only conversation. */
function chatLabel(chat: Chat): string {
  if (chat.name !== PLACEHOLDER_CHAT_NAME && chat.name.trim()) {
    return chat.name.trim();
  }
  const firstUser = chat.history.find((message) => message.role === 'user');
  if (firstUser?.content.trim()) {
    return firstUser.content.trim().split(/\r?\n/, 1)[0]!.slice(0, 58);
  }
  if (chat.composerDraft?.trim()) {
    return chat.composerDraft.trim().split(/\r?\n/, 1)[0]!.slice(0, 58);
  }
  return 'New conversation';
}

// ── Assistant mount ──────────────────────────────────────────────────────────

export function mountEmailAssistantPanel(
  shell: HTMLElement,
  workspace: HTMLElement,
  initialOptions: EmailAssistantPanelOptions,
): EmailAssistantPanelController {
  let account = initialOptions.account;
  let context = sanitizeEmailAssistantContext(initialOptions.context);
  let chatsWorkspacePath = '';
  let disposed = false;

  const toggle = el(
    'button',
    'email-assistant-toggle email-icon-btn email-readout-assistant',
  ) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.appendChild(createModeMaskIcon('general', 'email-assistant-toggle-icon'));
  toggle.setAttribute('aria-label', 'Open Email assistant');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.title = 'Open Email assistant';

  const dock = el('aside', 'email-assistant-dock');
  dock.setAttribute('aria-label', 'Email assistant');
  dock.setAttribute('aria-hidden', 'true');

  const header = el('header', 'email-assistant-header');
  const identity = el('div', 'email-assistant-identity');
  const titleRow = el('div', 'email-assistant-title-row');
  titleRow.append(
    createModeMaskIcon('general', 'email-assistant-title-icon'),
    el('h2', 'email-assistant-title', 'Email assistant'),
  );
  const contextLabel = el(
    'p',
    'email-assistant-context',
    formatEmailAssistantContextLabel(context),
  );
  identity.append(titleRow, contextLabel);

  const headerActions = el('div', 'email-assistant-header-actions');
  const newButton = el('button', 'email-assistant-header-btn', 'New') as HTMLButtonElement;
  newButton.type = 'button';
  const historyButton = el(
    'button',
    'email-assistant-header-btn',
    'History',
  ) as HTMLButtonElement;
  historyButton.type = 'button';
  historyButton.setAttribute('aria-expanded', 'false');
  const closeButton = iconButton(EMAIL_ICONS.close, 'Close Email assistant');
  headerActions.append(newButton, historyButton, closeButton);
  header.append(identity, headerActions);

  const scroll = el('div', 'email-assistant-scroll');
  scroll.setAttribute('role', 'log');
  scroll.setAttribute('aria-live', 'polite');
  scroll.setAttribute('aria-label', 'Email assistant messages');
  const messageColumn = el(
    'div',
    'chat-app-col email-assistant-message-col',
  );
  messageColumn.id = 'emailAssistantMessageCol';
  const reviewMount = el('div', 'email-assistant-review');
  scroll.append(messageColumn, reviewMount);

  const composer = el('footer', 'email-assistant-composer');
  const toolApprovalHost = el('div', 'tool-approval-host');
  toolApprovalHost.id = 'emailAssistantToolApprovalHost';
  toolApprovalHost.setAttribute('aria-live', 'polite');
  toolApprovalHost.hidden = true;
  const questionHost = el('div', 'question-host');
  questionHost.id = 'emailAssistantQuestionHost';
  questionHost.setAttribute('aria-live', 'polite');
  questionHost.hidden = true;
  const attachPreview = el('div', 'attach-preview hidden');
  attachPreview.id = 'emailAssistantAttachPreview';
  attachPreview.setAttribute('aria-live', 'polite');
  attachPreview.setAttribute('aria-label', 'Attached files');

  const inputRow = el('div', 'email-assistant-input-row');
  const attachButton = iconButton(
    EMAIL_ICONS.attach,
    'Attach files',
    'email-assistant-composer-btn',
  );
  const inputLabel = el('label', 'visually-hidden', 'Message Email assistant');
  inputLabel.htmlFor = 'emailAssistantInput';
  const input = el('textarea', 'email-assistant-input') as HTMLTextAreaElement;
  input.id = 'emailAssistantInput';
  input.rows = 1;
  input.placeholder = 'Ask about your email…';
  const stopButton = el('button', 'email-assistant-composer-btn') as HTMLButtonElement;
  stopButton.id = 'emailAssistantStopBtn';
  stopButton.type = 'button';
  stopButton.innerHTML = iconHtml('stop');
  stopButton.setAttribute('aria-label', 'Stop generation');
  stopButton.hidden = true;
  stopButton.disabled = true;
  const sendButton = el('button', 'email-assistant-send') as HTMLButtonElement;
  sendButton.id = 'emailAssistantSendBtn';
  sendButton.type = 'button';
  sendButton.innerHTML = iconHtml('arrowUp');
  sendButton.setAttribute('aria-label', 'Send message');
  inputRow.append(attachButton, inputLabel, input, stopButton, sendButton);
  composer.append(toolApprovalHost, questionHost, attachPreview, inputRow);

  dock.append(header, scroll, composer);
  shell.appendChild(dock);

  /** Keep the toggle in the readout row when the inbox surface is active. */
  const mountToggle = (container: HTMLElement | null): void => {
    if (disposed) return;
    if (container) {
      if (toggle.parentElement !== container) {
        container.appendChild(toggle);
      }
      return;
    }
    toggle.remove();
  };
  mountEmailAssistantDockResizer(dock, shell);

  const historyMenu = el('div', 'email-assistant-history');
  historyMenu.setAttribute('role', 'menu');
  historyMenu.setAttribute('aria-label', 'Email assistant history');
  historyMenu.hidden = true;
  document.body.appendChild(historyMenu);

  registerComposerSurface('email', {
    inputEl: input,
    sendBtnEl: sendButton,
  });
  initComposerSteerInputListener(input);
  initComposerDraftListener(input);
  initComposerSlashPicker(input);
  initComposerDrop();
  initComposerPaste();
  renderAttachPreview();

  /** Keep send, stop, and attachment affordances aligned with active chat state. */
  const syncComposerState = (): void => {
    const streaming = isActiveChatStreaming();
    sendButton.disabled = !shouldAllowComposerPrimaryAction(input.value);
    stopButton.hidden = !streaming;
    stopButton.disabled = !streaming;
    syncComposerFromStreamingState();
  };

  const renderEmptyState = (): void => {
    messageColumn.replaceChildren();
    const empty = el('div', 'email-assistant-empty');
    empty.append(
      el('h3', 'email-assistant-empty-title', 'What needs your attention?'),
      el(
        'p',
        'email-assistant-empty-copy',
        'Ask for a thread summary, a reply draft, calendar context, or a reviewable inbox cleanup.',
      ),
    );
    messageColumn.appendChild(empty);
  };

  /** Repaint persisted transcript without replacing the dock or composer. */
  const renderMessages = (): void => {
    if (!sessionState) {
      renderEmptyState();
      return;
    }
    const chat = getActiveChat();
    if (chat.appScope !== 'email' || chat.history.length === 0) {
      renderEmptyState();
    } else {
      renderChatFromHistory(chat, messageColumn);
    }
    syncComposerState();
  };

  /** Render history into the body portal and align it to its trigger. */
  const renderHistory = (): void => {
    historyMenu.replaceChildren();
    if (!sessionState || !chatsWorkspacePath) return;
    const chats = getEmailAssistantChats(chatsWorkspacePath, sessionState);
    if (chats.length === 0) {
      historyMenu.appendChild(
        el('p', 'email-assistant-history-empty', 'No conversations yet'),
      );
      return;
    }

    const activeId = sessionState.activeId;
    for (const chat of chats) {
      const row = el('button', 'email-assistant-history-row') as HTMLButtonElement;
      row.type = 'button';
      row.setAttribute('role', 'menuitem');
      row.classList.toggle('is-active', chat.id === activeId);
      row.append(
        el('span', 'email-assistant-history-title', chatLabel(chat)),
        el(
          'span',
          'email-assistant-history-meta',
          chat.history.length === 0
            ? 'Draft'
            : `${chat.history.length} message${chat.history.length === 1 ? '' : 's'}`,
        ),
      );
      row.addEventListener('click', () => {
        switchToChat(chat);
        closeHistory();
      });
      historyMenu.appendChild(row);
    }
  };

  const closeHistory = (): void => {
    historyMenu.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
  };

  const openHistory = (): void => {
    renderHistory();
    const rect = historyButton.getBoundingClientRect();
    historyMenu.style.top = `${Math.round(rect.bottom + 6)}px`;
    historyMenu.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
    historyMenu.hidden = false;
    historyButton.setAttribute('aria-expanded', 'true');
    historyMenu.querySelector<HTMLButtonElement>('button')?.focus();
  };

  /** Switch active sessions while preserving each chat's unsent composer draft. */
  const switchToChat = (chat: Chat): void => {
    if (!sessionState) return;
    const previousId = sessionState.activeId;
    void activateChatById(chat.id).then(() => {
      if (!sessionState || sessionState.activeId !== chat.id) return;
      switchComposerDraft(previousId, chat);
      resizeComposer(input);
      syncAskQuestionModalOnChatSwitch(previousId, chat.id);
      notifyAskQuestionDisplayContextChanged();
      void resumeIncompleteToolBatchOnChatSwitch(chat);
      renderMessages();
      void import('../../tools/stream-chat-dom').then((module) =>
        module.remountStreamDomForChat(chat.id),
      );
      input.focus();
    });
  };

  /** Ensure the Email-scoped session is active before any transcript operation. */
  const ensureEmailChat = async (): Promise<Chat> => {
    const previousId = sessionState?.activeId;
    const ready = await ensureActiveEmailAssistantChat();
    chatsWorkspacePath = ready.workspacePath;
    if (previousId !== ready.chat.id) {
      switchComposerDraft(previousId, ready.chat);
    }
    resizeComposer(input);
    return ready.chat;
  };

  const refreshReview = async (): Promise<void> => {
    reviewMount.replaceChildren();
    reviewMount.hidden = true;
    if (!account || disposed) return;
    const requestedAccount = account;

    try {
      const payload = await fetchInboxSummary(requestedAccount.id);
      if (disposed || account?.id !== requestedAccount.id) return;
      const dashboardOptions: EmailDashboardOptions = {
        account: requestedAccount,
        onOpenThread: () => undefined,
        onOpenMail: () => undefined,
        onStatus: initialOptions.onStatus,
        onRefresh: () => {
          initialOptions.onMailRefresh?.();
          void refreshReview();
        },
      };
      renderPendingActions(
        reviewMount,
        requestedAccount,
        payload.pendingActions ?? [],
        dashboardOptions,
      );
      reviewMount.hidden = reviewMount.childElementCount === 0;
    } catch (error) {
      if (disposed || account?.id !== requestedAccount.id) return;
      reviewMount.hidden = false;
      reviewMount.replaceChildren(
        el(
          'p',
          'email-assistant-review-error',
          error instanceof Error ? error.message : 'Could not load review actions',
        ),
      );
    }
  };

  const send = async (): Promise<void> => {
    try {
      await ensureEmailChat();
    } catch (error) {
      initialOptions.onStatus?.(
        'err',
        error instanceof Error ? error.message : 'Email assistant is unavailable',
      );
      return;
    }
    await sendMessage({
      inputEl: input,
      sendBtnEl: sendButton,
      ephemeralContext: buildEmailAssistantContextPrompt(context),
    });
    renderMessages();
    renderHistory();
    syncComposerState();
  };

  const open = async (): Promise<void> => {
    if (disposed) return;
    try {
      await ensureEmailChat();
    } catch (error) {
      initialOptions.onStatus?.(
        'err',
        error instanceof Error ? error.message : 'Email assistant is unavailable',
      );
      return;
    }
    shell.classList.add('has-assistant');
    dock.classList.add('is-open');
    dock.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close Email assistant');
    toggle.setAttribute('aria-hidden', 'true');
    toggle.tabIndex = -1;
    notifyAskQuestionDisplayContextChanged();
    syncEmailAssistantDockResizer(dock);
    renderMessages();
    renderHistory();
    void refreshReview();
    requestAnimationFrame(() => {
      resizeComposer(input);
      input.focus();
    });
  };

  const close = (): void => {
    if (disposed) return;
    closeHistory();
    shell.classList.remove('has-assistant');
    dock.classList.remove('is-open');
    dock.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open Email assistant');
    toggle.setAttribute('aria-hidden', 'false');
    toggle.tabIndex = 0;
    notifyAskQuestionDisplayContextChanged();
    syncEmailAssistantDockResizer(dock);
    toggle.focus();
  };

  toggle.addEventListener('click', () => {
    if (dock.classList.contains('is-open')) {
      close();
      return;
    }
    void open();
  });
  closeButton.addEventListener('click', close);
  historyButton.addEventListener('click', () => {
    if (historyMenu.hidden) openHistory();
    else closeHistory();
  });
  newButton.addEventListener('click', async () => {
    try {
      const current = await ensureEmailChat();
      const fresh = createEmailAssistantChatForApp(
        chatsWorkspacePath,
        current.modelId,
      );
      switchComposerDraft(current.id, fresh);
      resizeComposer(input);
      scheduleSaveSessions();
      renderMessages();
      renderHistory();
      input.focus();
    } catch (error) {
      initialOptions.onStatus?.(
        'err',
        error instanceof Error ? error.message : 'Could not create a conversation',
      );
    }
  });
  attachButton.addEventListener('click', () => {
    (document.getElementById('fileInput') as HTMLInputElement | null)?.click();
  });
  stopButton.addEventListener('click', () => stopGeneration());
  sendButton.addEventListener('click', () => void send());
  input.addEventListener('input', () => {
    resizeComposer(input);
    syncComposerState();
  });
  input.addEventListener('keydown', (event) => {
    if (handleSkillPickerKeydown(event)) return;
    if (handleComposerPromptHistoryKeydown(event, input)) return;
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || isSkillPickerOpen()) return;
    event.preventDefault();
    void send();
  });
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (historyMenu.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (historyMenu.contains(target) || historyButton.contains(target)) return;
    closeHistory();
  };
  document.addEventListener('pointerdown', onDocumentPointerDown);

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (!historyMenu.hidden) {
      event.preventDefault();
      closeHistory();
      historyButton.focus();
      return;
    }
    if (dock.classList.contains('is-open') && dock.contains(document.activeElement)) {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onDocumentKeyDown);

  const unsubscribeStreamEnd = subscribeChatStreamEnd((chatId) => {
    if (disposed || !sessionState) return;
    const chat = sessionState.chats.find((candidate) => candidate.id === chatId);
    if (!chat || chat.appScope !== 'email') return;
    if (sessionState.activeId === chatId && dock.classList.contains('is-open')) {
      renderMessages();
    }
    renderHistory();
    void refreshReview();
  });

  return {
    open,
    close,
    isOpen: () => dock.classList.contains('is-open'),
    mountToggle,
    setAccount: (nextAccount) => {
      account = nextAccount;
      void refreshReview();
    },
    setContext: (nextContext) => {
      context = sanitizeEmailAssistantContext(nextContext);
      contextLabel.textContent = formatEmailAssistantContextLabel(context);
    },
    refreshReview,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeStreamEnd();
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      disposeEmailAssistantDockResizer(dock);
      closeHistory();
      historyMenu.remove();
      registerComposerSurface('email', { inputEl: null, sendBtnEl: null });
    },
  };
}
