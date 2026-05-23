/**
 * Per-user-message branch picker when multiple turn runs exist at a fork.
 */

import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  activateBranch,
  getActiveRun,
  listSelectableBranchesAtFork,
} from '../state/runs-store';
import { findChatById, getActiveChat, scheduleSaveSessions, touchChat } from '../state/sessions';
import type { Chat, TurnRunRecord } from '../types';
import { renderChatFromHistory } from './messages';
import { renderStatsForChat } from './messages';
import { renderSidebar } from './sidebar';
import { setStatus } from './status';

function branchLabel(run: TurnRunRecord, index: number): string {
  const model = run.snapshot.modelId || 'model';
  const provider = run.snapshot.providerId || 'provider';
  return `Branch ${index + 1} — ${model} @ ${provider}`;
}

function closeBranchMenu(menu: HTMLElement | null): void {
  if (!menu) return;
  menu.remove();
}

/** Attach branch pill to a user message row when multiple branches exist. */
export function attachBranchPicker(
  wrap: HTMLElement,
  chatId: string,
  forkHistoryIndex: number,
): void {
  const chat =
    findChatById(chatId) ??
    (getActiveChat().id === chatId ? getActiveChat() : undefined);
  if (!chat) return;

  const branches = listSelectableBranchesAtFork(chat, forkHistoryIndex);
  if (branches.length < 2) return;

  const active = getActiveRun(chat, forkHistoryIndex);
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'branch-picker__trigger';
  pill.setAttribute('aria-haspopup', 'menu');
  pill.setAttribute('aria-expanded', 'false');
  pill.textContent = `▾ ${branches.length} branches`;

  let openMenu: HTMLElement | null = null;

  const setExpanded = (open: boolean): void => {
    pill.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  pill.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (isActiveChatStreaming()) {
      setStatus('spin', 'Finish or stop the current reply first');
      return;
    }
    if (openMenu) {
      closeBranchMenu(openMenu);
      openMenu = null;
      setExpanded(false);
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'branch-picker__menu';
    menu.setAttribute('role', 'menu');

    const sorted = [...branches].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < sorted.length; i += 1) {
      const run = sorted[i]!;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'branch-picker__item';
      item.setAttribute('role', 'menuitem');
      item.textContent = branchLabel(run, i);
      if (active?.branchId === run.branchId) {
        item.classList.add('branch-picker__item--active');
        item.setAttribute('aria-current', 'true');
      }
      item.addEventListener('click', (itemEv) => {
        itemEv.stopPropagation();
        closeBranchMenu(menu);
        openMenu = null;
        setExpanded(false);
        switchBranch(chat, forkHistoryIndex, run.branchId);
      });
      menu.appendChild(item);
    }

    pill.after(menu);
    openMenu = menu;
    setExpanded(true);

    const onDoc = (docEv: MouseEvent): void => {
      const t = docEv.target as Node;
      if (menu.contains(t) || pill.contains(t)) return;
      closeBranchMenu(menu);
      openMenu = null;
      setExpanded(false);
      document.removeEventListener('click', onDoc, true);
    };
    const onKey = (keyEv: KeyboardEvent): void => {
      if (keyEv.key === 'Escape') {
        closeBranchMenu(menu);
        openMenu = null;
        setExpanded(false);
        document.removeEventListener('keydown', onKey);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener('click', onDoc, true);
      document.addEventListener('keydown', onKey);
    });
  });

  wrap.classList.add('msg--has-branch-picker');
  wrap.appendChild(pill);
}

function switchBranch(chat: Chat, forkHistoryIndex: number, branchId: string): void {
  const ok = activateBranch(chat, forkHistoryIndex, branchId);
  if (!ok) {
    setStatus('err', 'Could not switch branch');
    return;
  }
  touchChat(chat);
  scheduleSaveSessions();
  renderChatFromHistory(chat);
  renderStatsForChat(chat);
  renderSidebar();
  setStatus('ok', 'Branch switched');
}
