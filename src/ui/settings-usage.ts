/**
 * Settings → Usage & cost (token ledger rollups and cost estimates).
 */

import '../styles/settings-general.css';
import '../styles/settings-usage.css';

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
import type { TokenLedgerBySource, TokenLedgerEntry, TokenLedgerTotals } from '../usage/types';
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { appendSettingsOfflineHint } from './settings-controls';

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
    return new Date(at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(at);
  }
}

/** Short workspace label for the session rollup heading. */
function formatWorkspaceLabel(workspace: string): string {
  if (!workspace) return 'All chats in this browser session';
  const parts = workspace.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return `…/${parts.slice(-2).join('/')}`;
}

/** Human-readable label for a rollup key (e.g. main:build → Main (build)). */
function formatSourceKey(key: string): string {
  if (key.startsWith('main:')) {
    const rest = key.slice(5);
    const colon = rest.indexOf(':');
    if (colon === -1) return `Main (${rest})`;
    return `Main (${rest.slice(0, colon)}) · ${rest.slice(colon + 1)}`;
  }
  if (key.startsWith('sub-agent:')) return `Sub-agent (${key.slice(10)})`;
  if (key.startsWith('work-agent:')) return `Work agent (${key.slice(11)})`;
  if (key === 'title') return 'Chat title';
  if (key === 'reef-widget') return 'Reef widget';
  if (key === 'orchestrate-board') return 'Orchestrate board';
  return key;
}

/** Instrument-style metric strip for ledger totals. */
function appendUsageMetrics(mount: HTMLElement, totals: TokenLedgerTotals): void {
  const list = el('ul', 'usage-metrics');
  list.setAttribute('role', 'list');

  const metrics: { label: string; value: string; valueClass?: string }[] = [
    { label: 'Completions', value: String(totals.completionCount) },
    { label: 'Total tokens', value: formatTokens(totals.totalTokens) },
    {
      label: 'Estimated cost',
      value: formatUsd(totals.costUsd > 0 ? totals.costUsd : null),
      valueClass: totals.costUsd > 0 ? 'usage-metric__value--cost' : 'usage-metric__value--muted',
    },
  ];

  for (const metric of metrics) {
    const item = el('li', 'usage-metric');
    item.setAttribute('role', 'listitem');
    item.append(
      el('span', 'usage-metric__label', metric.label),
      el('span', `usage-metric__value${metric.valueClass ? ` ${metric.valueClass}` : ''}`, metric.value),
    );
    list.appendChild(item);
  }

  mount.appendChild(list);
}

/** Prompt vs completion token split bar (stats-strip colors). */
function appendTokenSplit(mount: HTMLElement, totals: TokenLedgerTotals): void {
  const prompt = totals.promptTokens;
  const completion = totals.completionTokens;
  const sum = prompt + completion;
  if (sum <= 0) return;

  const wrap = el('div', 'usage-token-split');
  const track = el('div', 'usage-token-split__track');
  track.setAttribute('role', 'img');
  track.setAttribute(
    'aria-label',
    `Token split: ${formatTokens(prompt)} prompt, ${formatTokens(completion)} completion`,
  );

  const promptFill = el('div', 'usage-token-split__fill usage-token-split__fill--prompt');
  promptFill.style.flex = String(prompt);
  const completionFill = el('div', 'usage-token-split__fill usage-token-split__fill--completion');
  completionFill.style.flex = String(completion);
  track.append(promptFill, completionFill);

  const legend = el('p', 'usage-token-split__legend');
  legend.innerHTML = `<strong>${formatTokens(prompt)}</strong> prompt · <strong>${formatTokens(completion)}</strong> completion`;
  wrap.append(track, legend);
  mount.appendChild(wrap);
}

/** Roll up totals, split bar, and optional breakdown sections. */
function appendUsageRollup(
  mount: HTMLElement,
  totals: TokenLedgerTotals,
  bySource: TokenLedgerBySource,
  entries: TokenLedgerEntry[],
): void {
  appendUsageMetrics(mount, totals);
  appendTokenSplit(mount, totals);

  const sourceKeys = Object.keys(bySource).sort();
  if (sourceKeys.length > 0) {
    const subsection = el('div', 'usage-subsection');
    subsection.appendChild(el('h4', 'usage-subsection__title', 'By source'));

    const list = el('ul', 'usage-breakdown');
    for (const key of sourceKeys) {
      const row = bySource[key]!;
      const item = el('li', 'usage-breakdown__row');
      item.append(
        el('span', 'usage-breakdown__source', formatSourceKey(key)),
        el('span', 'usage-breakdown__stat', `${row.completionCount} completions`),
        el('span', 'usage-breakdown__stat usage-breakdown__stat--mono', formatTokens(row.totalTokens)),
        el(
          'span',
          'usage-breakdown__stat usage-breakdown__stat--mono',
          formatUsd(row.costUsd > 0 ? row.costUsd : null),
        ),
      );
      list.appendChild(item);
    }
    subsection.appendChild(list);
    mount.appendChild(subsection);
  }

  if (entries.length > 0) {
    const recent = [...entries].sort((a, b) => b.at - a.at).slice(0, 12);
    const subsection = el('div', 'usage-subsection');
    subsection.appendChild(el('h4', 'usage-subsection__title', 'Recent completions'));

    const scroll = el('div', 'usage-recent-wrap');
    const table = el('table', 'usage-recent');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const heading of ['Time', 'Source', 'Model', 'Tokens', 'Cost']) {
      headRow.appendChild(el('th', undefined, heading));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const entry of recent) {
      const total =
        entry.usage.total_tokens ??
        (entry.usage.prompt_tokens ?? 0) + (entry.usage.completion_tokens ?? 0);
      const tr = document.createElement('tr');
      tr.append(
        el('td', 'usage-recent__time', formatTime(entry.at)),
        el('td', undefined, formatSourceLabel(entry.source)),
        el('td', 'usage-recent__model', entry.modelId || '—'),
        el('td', 'usage-recent__mono', formatTokens(total)),
        el('td', 'usage-recent__mono', formatUsd(entry.costUsd)),
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    subsection.appendChild(scroll);
    mount.appendChild(subsection);
  }
}

function appendUsageEmpty(mount: HTMLElement, message: string): void {
  mount.appendChild(el('p', 'usage-empty', message));
}

/** Render Usage panel into #settingsUsageBody. */
export async function renderUsageSettingsSection(): Promise<void> {
  const mount = document.getElementById('settingsUsageBody');
  if (!mount) return;
  mount.replaceChildren();

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Recorded completions from provider-reported usage metadata. Separate from the ',
    linkToSettingsSection('Agents', 'agent-center'),
    ' prompt estimate before each send.',
  );
  shell.appendChild(lead);

  const serverUp = await detectLocalServer();
  if (!isServerStorageMode() || !serverUp) {
    appendSettingsOfflineHint(
      shell,
      'Start with <code>npm start</code> to edit provider pricing on the server. Session ledger data below is still available in this browser.',
      { id: 'settingsUsageOffline', searchKey: 'models.usage' },
    );
  }

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const pricing = appendSettingsGroup(
    content,
    'Model pricing',
    'USD per 1M tokens on each provider profile drives the cost estimates below.',
    'models.usage.pricing',
    { emphasis: true },
  );
  const pricingHint = el('p', 'usage-pricing-hint');
  pricingHint.append(
    'Set rates under ',
    linkToSettingsSection('Providers', 'providers'),
    ' (optional “Model pricing” on each provider). Local providers can leave zeros.',
  );
  pricing.appendChild(pricingHint);

  const activeChat = getActiveChat();
  const activeLedger = activeChat.tokenLedger;
  const activeTitle = activeChat.title?.trim();
  const activeGroup = appendSettingsGroup(
    content,
    'Active chat',
    activeTitle ? `“${activeTitle}”` : 'The chat open in this window.',
    'models.usage.active',
    { emphasis: true },
  );

  if (!activeLedger || activeLedger.totals.completionCount === 0) {
    appendUsageEmpty(
      activeGroup,
      'No recorded completions yet. Send a message with a provider that returns usage metadata.',
    );
  } else {
    appendUsageRollup(
      activeGroup,
      activeLedger.totals,
      activeLedger.bySource,
      activeLedger.entries,
    );
  }

  const workspace = getWorkspacePath();
  const sessionChats = getChatsForWorkspace(workspace);
  const sessionTotals = sumSessionLedgerTotals(sessionChats);
  const sessionBySource = mergeSessionBySource(sessionChats);

  const sessionGroup = appendSettingsGroup(
    content,
    'Workspace session',
    formatWorkspaceLabel(workspace),
    'models.usage.session',
    { emphasis: true },
  );

  if (sessionTotals.completionCount === 0) {
    appendUsageEmpty(sessionGroup, 'No recorded usage for chats in this workspace session.');
  } else {
    const sessionEntries = sessionChats.flatMap((chat) => chat.tokenLedger?.entries ?? []);
    appendUsageRollup(sessionGroup, sessionTotals, sessionBySource, sessionEntries);
  }
}
