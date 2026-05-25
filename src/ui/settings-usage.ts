/**
 * Settings → Usage & cost (Feature #14).
 */

import { isServerStorageMode } from '../config/storage-mode';
import { detectLocalServer } from '../tools/client';
import { getActiveChat, getChatsForWorkspace } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import {
  formatSourceLabel,
  formatUsd,
  mergeSessionBySource,
  sumSessionLedgerTotals,
} from '../usage/token-ledger';
import type { TokenLedgerEntry } from '../usage/types';

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

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return String(at);
  }
}

function buildTotalsTable(
  title: string,
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    completionCount: number;
  },
): HTMLElement {
  const block = el('div', 'settings-usage-block');
  block.append(el('h3', 'settings-usage-subhead', title));
  const table = el('table', 'settings-usage-table');
  const tbody = document.createElement('tbody');
  const rows: [string, string][] = [
    ['Completions', String(totals.completionCount)],
    ['Prompt tokens', formatTokens(totals.promptTokens)],
    ['Completion tokens', formatTokens(totals.completionTokens)],
    ['Total tokens', formatTokens(totals.totalTokens)],
    ['Estimated cost', formatUsd(totals.costUsd > 0 ? totals.costUsd : null)],
  ];
  for (const [label, value] of rows) {
    const tr = document.createElement('tr');
    tr.append(el('th', undefined, label), el('td', undefined, value));
    tbody.append(tr);
  }
  table.append(tbody);
  block.append(table);
  return block;
}

function buildBySourceTable(
  bySource: Record<string, { totalTokens: number; costUsd: number; completionCount: number }>,
): HTMLElement | null {
  const keys = Object.keys(bySource).sort();
  if (keys.length === 0) return null;
  const block = el('div', 'settings-usage-block');
  block.append(el('h3', 'settings-usage-subhead', 'By source'));
  const table = el('table', 'settings-usage-table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['Source', 'Completions', 'Tokens', 'Cost']) {
    headRow.append(el('th', undefined, h));
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement('tbody');
  for (const key of keys) {
    const row = bySource[key]!;
    const tr = document.createElement('tr');
    tr.append(
      el('td', undefined, key),
      el('td', undefined, String(row.completionCount)),
      el('td', undefined, formatTokens(row.totalTokens)),
      el('td', undefined, formatUsd(row.costUsd > 0 ? row.costUsd : null)),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  block.append(table);
  return block;
}

function buildRecentEntries(entries: TokenLedgerEntry[]): HTMLElement | null {
  if (entries.length === 0) return null;
  const recent = [...entries].sort((a, b) => b.at - a.at).slice(0, 10);
  const block = el('div', 'settings-usage-block');
  block.append(el('h3', 'settings-usage-subhead', 'Recent completions'));
  const table = el('table', 'settings-usage-table settings-usage-table--compact');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['Time', 'Source', 'Model', 'Tokens', 'Cost']) {
    headRow.append(el('th', undefined, h));
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement('tbody');
  for (const entry of recent) {
    const total =
      entry.usage.total_tokens ??
      (entry.usage.prompt_tokens ?? 0) + (entry.usage.completion_tokens ?? 0);
    const tr = document.createElement('tr');
    tr.append(
      el('td', undefined, formatTime(entry.at)),
      el('td', undefined, formatSourceLabel(entry.source)),
      el('td', undefined, entry.modelId || '—'),
      el('td', undefined, formatTokens(total)),
      el('td', undefined, formatUsd(entry.costUsd)),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  block.append(table);
  return block;
}

/** Render Usage panel into #settingsUsageBody. */
export async function renderUsageSettingsSection(): Promise<void> {
  const mount = document.getElementById('settingsUsageBody');
  if (!mount) return;
  mount.replaceChildren();

  const intro = el(
    'p',
    'field-hint',
    'Recorded usage comes from provider-reported completion tokens when available. This is not the same as the Prompting “next send” estimate.',
  );
  mount.append(intro);

  const offline = el('p', 'field-hint settings-usage-offline hidden');
  offline.id = 'settingsUsageOffline';
  offline.innerHTML =
    'Start with <code>npm start</code> to edit provider pricing. Session ledger data below is still available in this browser.';
  mount.append(offline);

  const serverUp = await detectLocalServer();
  if (!isServerStorageMode() || !serverUp) {
    offline.classList.remove('hidden');
  }

  const pricingHint = el('p', 'field-hint');
  pricingHint.innerHTML =
    'Configure per-model rates under <button type="button" class="settings-inline-link" data-settings-jump="providers">Providers</button> (optional “Model pricing” on each provider).';
  pricingHint.querySelector('[data-settings-jump]')?.addEventListener('click', () => {
    window.location.hash = '#/settings/providers';
  });
  mount.append(pricingHint);

  const activeChat = getActiveChat();
  const activeLedger = activeChat.tokenLedger;
  if (!activeLedger || activeLedger.totals.completionCount === 0) {
    mount.append(
      el(
        'p',
        'settings-usage-empty',
        'No recorded completions yet for the active chat. Send a message with a provider that returns usage metadata.',
      ),
    );
  } else {
    mount.append(buildTotalsTable('Active chat', activeLedger.totals));
    const bySource = buildBySourceTable(activeLedger.bySource);
    if (bySource) mount.append(bySource);
    const recent = buildRecentEntries(activeLedger.entries);
    if (recent) mount.append(recent);
  }

  const workspace = getWorkspacePath();
  const sessionChats = getChatsForWorkspace(workspace);
  const sessionTotals = sumSessionLedgerTotals(sessionChats);
  const sessionBySource = mergeSessionBySource(sessionChats);

  mount.append(el('hr', 'settings-usage-divider'));
  if (sessionTotals.completionCount === 0) {
    mount.append(
      el('p', 'settings-usage-empty', 'No recorded usage for chats in this workspace session.'),
    );
  } else {
    mount.append(
      buildTotalsTable(
        workspace ? `All chats (${workspace})` : 'All chats (session)',
        sessionTotals,
      ),
    );
    const sessionTable = buildBySourceTable(sessionBySource);
    if (sessionTable) mount.append(sessionTable);
  }
}
