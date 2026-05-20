/**
 * Minimal Work Agent selector (dev / ?dev=1 until Step 20).
 */

import { streaming } from '../app-state';
import { listWorkAgents } from '../agents/work-agent-registry';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { renderSidebar } from './sidebar';

let devRoot: HTMLElement | null = null;

function isDevWorkAgentUiEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dev') === '1';
}

function getDevRoot(): HTMLElement | null {
  if (!devRoot) {
    devRoot = document.getElementById('workAgentDev');
  }
  return devRoot;
}

/** Show dev block when ?dev=1. */
export function initWorkAgentDevUi(): void {
  const root = getDevRoot();
  if (!root) return;

  if (isDevWorkAgentUiEnabled()) {
    root.classList.remove('hidden');
  } else {
    root.classList.add('hidden');
    return;
  }

  const select = document.getElementById('workAgentSelect') as HTMLSelectElement | null;
  const autoBox = document.getElementById('workAgentAuto') as HTMLInputElement | null;
  if (!select || !autoBox) return;

  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Default assistant';
  select.appendChild(empty);

  for (const agent of listWorkAgents()) {
    if (agent.id === 'default') continue;
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = agent.label;
    if (agent.disabled) opt.disabled = true;
    select.appendChild(opt);
  }

  if (!select.dataset.bound) {
    select.dataset.bound = '1';
    select.addEventListener('change', () => {
      if (streaming) return;
      const chat = getActiveChat();
      const value = select.value.trim();
      chat.workAgentId = value || null;
      chat.workAgentAuto = false;
      touchChat(chat);
      scheduleSaveSessions();
      renderSidebar();
    });

    autoBox.addEventListener('change', () => {
      if (streaming) return;
      const chat = getActiveChat();
      chat.workAgentAuto = autoBox.checked;
      touchChat(chat);
      scheduleSaveSessions();
      syncWorkAgentDevFromActiveChat();
    });
  }

  syncWorkAgentDevFromActiveChat();
}

/** Sync select + checkbox from active chat. */
export function syncWorkAgentDevFromActiveChat(): void {
  if (!isDevWorkAgentUiEnabled()) return;

  const select = document.getElementById('workAgentSelect') as HTMLSelectElement | null;
  const autoBox = document.getElementById('workAgentAuto') as HTMLInputElement | null;
  if (!select || !autoBox) return;

  const chat = getActiveChat();
  autoBox.checked = chat.workAgentAuto !== false;
  select.disabled = autoBox.checked || streaming;

  const id = chat.workAgentId;
  if (!id || id === 'default') {
    select.value = '';
  } else {
    select.value = id;
  }
}

/** Abbreviation for sidebar badge (first 3 letters uppercase). */
export function workAgentSidebarAbbrev(agentId: string | null | undefined): string {
  if (!agentId || agentId === 'default') return '';
  const agent = listWorkAgents().find((a) => a.id === agentId);
  const label = agent?.label ?? agentId;
  return label.slice(0, 3).toUpperCase();
}
