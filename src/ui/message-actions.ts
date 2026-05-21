/**
 * Per-message ⋮ menu: copy, edit, delete, regenerate, remake (Epic C2).
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  indexOfUserBeforeBlock,
  truncateChatHistory,
  updateUserMessageAt,
} from '../chat/history-truncate';
import { resendFromIndex } from '../chat/resend-from-index';
import { stripSkillTagFromHistory } from '../skills/history-content';
import { getActiveChat } from '../state/sessions';
import { renderChatFromHistory, renderStatsForChat } from './messages';
import { renderSidebar } from './sidebar';
import { setStatus } from './status';

export type MessageTurnKind = 'user' | 'assistant' | 'assistant-tools';

export interface MessageActionTarget {
  chatId: string;
  historyIndex: number;
  turnKind: MessageTurnKind;
}

let openMenu: HTMLElement | null = null;
let pendingEdit: { chatId: string; historyIndex: number } | null = null;

/** Pending user-message edit awaiting the next send. */
export function consumePendingMessageEdit(): {
  chatId: string;
  historyIndex: number;
} | null {
  const next = pendingEdit;
  pendingEdit = null;
  return next;
}

/** Close any open message actions dropdown. */
export function closeMessageActionsMenu(): void {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
}

function guardStreaming(): boolean {
  if (!isActiveChatStreaming()) return false;
  setStatus('spin', 'Finish or stop the current reply first');
  return true;
}

function getCopyText(wrap: HTMLElement): string {
  const bubble = wrap.querySelector('.msg-bubble');
  if (bubble) return (bubble.textContent ?? '').trim();
  return (wrap.textContent ?? '').trim();
}

function shouldConfirmDelete(historyIndex: number): boolean {
  const chat = getActiveChat();
  const remaining = chat.history.length - historyIndex;
  return remaining > 1;
}

function buildMenuButton(label: string, action: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'message-actions__item';
  btn.textContent = label;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeMessageActionsMenu();
    action();
  });
  return btn;
}

function openMenuAt(trigger: HTMLButtonElement, items: HTMLButtonElement[]): void {
  closeMessageActionsMenu();
  const menu = document.createElement('div');
  menu.className = 'message-actions__menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    menu.appendChild(item);
  }
  trigger.after(menu);
  openMenu = menu;

  const onDocClick = (ev: MouseEvent): void => {
    const t = ev.target as Node;
    if (menu.contains(t) || trigger.contains(t)) return;
    closeMessageActionsMenu();
    document.removeEventListener('click', onDocClick, true);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      closeMessageActionsMenu();
      document.removeEventListener('keydown', onKey);
    }
  };
  requestAnimationFrame(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
  });
}

/** Wire ⋮ menu on a rendered message row. */
export function attachMessageActions(
  wrap: HTMLElement,
  target: MessageActionTarget,
): void {
  if (wrap.dataset.streaming === 'true') return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'message-actions__trigger';
  trigger.setAttribute('aria-label', 'Message actions');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.textContent = '⋮';

  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (guardStreaming()) return;

    const items: HTMLButtonElement[] = [];
    items.push(
      buildMenuButton('Copy', () => {
        const text = getCopyText(wrap);
        void navigator.clipboard.writeText(text).then(
          () => setStatus('ok', 'Copied'),
          () => setStatus('err', 'Could not copy'),
        );
      }),
    );

    if (target.turnKind === 'user') {
      items.push(
        buildMenuButton('Edit', () => {
          const chat = getActiveChat();
          const row = chat.history[target.historyIndex];
          if (!row || row.role !== 'user') return;
          truncateChatHistory(target.chatId, target.historyIndex, 'inclusive');
          renderChatFromHistory(getActiveChat());
          const input = document.getElementById('msgInput') as HTMLTextAreaElement;
          input.value = stripSkillTagFromHistory(row.content);
          input.focus();
          pendingEdit = {
            chatId: target.chatId,
            historyIndex: target.historyIndex,
          };
        }),
      );
      items.push(
        buildMenuButton('Regenerate from here', () => {
          void resendFromIndex(target.chatId, target.historyIndex);
        }),
      );
    }

    if (target.turnKind === 'assistant' || target.turnKind === 'assistant-tools') {
      items.push(
        buildMenuButton('Remake', () => {
          const chat = getActiveChat();
          const userIdx = indexOfUserBeforeBlock(chat.history, target.historyIndex);
          if (userIdx < 0) {
            setStatus('err', 'No user message to resend from');
            return;
          }
          void resendFromIndex(target.chatId, userIdx);
        }),
      );
    }

    items.push(
      buildMenuButton('Delete message', () => {
        if (shouldConfirmDelete(target.historyIndex)) {
          const ok = confirm('Delete this message and all messages after it?');
          if (!ok) return;
        }
        const result = truncateChatHistory(
          target.chatId,
          target.historyIndex,
          'exclusive',
        );
        if (!result.ok) {
          if (result.error === 'streaming') guardStreaming();
          else setStatus('err', 'Could not delete');
          return;
        }
        const chat = getActiveChat();
        renderChatFromHistory(chat);
        renderStatsForChat(chat);
        renderSidebar();
        setStatus('ok', 'Message deleted');
      }),
    );

    openMenuAt(trigger, items);
  });

  wrap.classList.add('msg--has-actions');
  wrap.appendChild(trigger);
}

/** After edit+send: replace user row and resend from that index. */
export async function completePendingMessageEdit(
  chatId: string,
  historyIndex: number,
  newContent: string,
): Promise<void> {
  if (guardStreaming()) return;
  const tagged = newContent.trim();
  if (!updateUserMessageAt(chatId, historyIndex, tagged)) {
    setStatus('err', 'Could not update message');
    return;
  }
  renderChatFromHistory(getActiveChat());
  await resendFromIndex(chatId, historyIndex);
}
