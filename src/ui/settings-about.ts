/**
 * Settings → About → Diagnostics — local error viewer and report copy.
 */

import '../styles/settings-about.css';
import { detectConfigServer } from '../config/storage-mode';
import { appendSettingsGroup } from './settings-layout';
import { appendSettingsOfflineHint, createSettingsActionsRow } from './settings-controls';
import { setStatus } from './status';
import {
  fetchDiagnosticsHealth,
  renderHealthStrip,
  type DiagnosticsHealthPayload,
} from './health-strip';

type DiagnosticErrorGroup = {
  signature: string;
  count: number;
  lastAt?: string;
  source?: string;
  kind?: string;
  message?: string;
  stack?: string;
};

type SourceFilter = 'all' | 'renderer' | 'server' | 'electron';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearMount(id: string): HTMLElement | null {
  const mount = document.getElementById(id);
  if (!mount) return null;
  mount.replaceChildren();
  return mount;
}

/** Load grouped errors for the viewer. */
async function fetchDiagnosticErrors(source: SourceFilter): Promise<DiagnosticErrorGroup[]> {
  const params = new URLSearchParams({ source, maxLines: '200' });
  const res = await fetch(`/api/diagnostics/errors?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load errors');
  const body = (await res.json()) as { errors?: DiagnosticErrorGroup[] };
  return body.errors ?? [];
}

/** Load tail log lines for the viewer. */
async function fetchDiagnosticLogs(source: SourceFilter): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ source, maxLines: '80' });
  const res = await fetch(`/api/diagnostics/logs?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load logs');
  const body = (await res.json()) as { lines?: Record<string, unknown>[] };
  return body.lines ?? [];
}

function renderFilterRow(
  onChange: (source: SourceFilter) => void,
  active: SourceFilter,
): HTMLElement {
  const row = el('div', 'diagnostics-filter-row');
  const filters: Array<{ id: SourceFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'renderer', label: 'Renderer' },
    { id: 'server', label: 'Server' },
    { id: 'electron', label: 'Electron' },
  ];
  for (const f of filters) {
    const btn = el('button', 'diagnostics-filter-btn', f.label);
    btn.type = 'button';
    btn.dataset.source = f.id;
    btn.classList.toggle('is-active', f.id === active);
    btn.addEventListener('click', () => onChange(f.id));
    row.appendChild(btn);
  }
  return row;
}

function renderErrorList(host: HTMLElement, errors: DiagnosticErrorGroup[]): void {
  host.replaceChildren();
  if (!errors.length) {
    host.appendChild(el('p', 'diagnostics-empty', 'No captured errors yet.'));
    return;
  }

  const list = el('ul', 'diagnostics-error-list');
  for (const group of errors) {
    const item = el('li', 'diagnostics-error-item');
    const head = el('div', 'diagnostics-error-item__head');
    const title = el('span', 'diagnostics-error-item__title', group.message || group.signature);
    const badge = el('span', 'diagnostics-error-item__badge', `×${group.count}`);
    head.append(title, badge);
    item.appendChild(head);

    const meta = el('div', 'diagnostics-error-item__meta');
    if (group.source) meta.appendChild(el('span', '', `${group.source}`));
    if (group.lastAt) meta.appendChild(el('span', '', group.lastAt));
    item.appendChild(meta);

    if (group.stack) {
      const pre = el('pre', 'diagnostics-error-item__stack', group.stack);
      item.appendChild(pre);
    }
    list.appendChild(item);
  }
  host.appendChild(list);
}

function renderLogTail(host: HTMLElement, lines: Record<string, unknown>[]): void {
  host.replaceChildren();
  if (!lines.length) {
    host.appendChild(el('p', 'diagnostics-empty', 'Log tail is empty.'));
    return;
  }
  const pre = el('pre', 'diagnostics-log-tail');
  pre.textContent = lines.map((line) => JSON.stringify(line)).join('\n');
  host.appendChild(pre);
}

/** Populate Settings → About (diagnostics viewer). */
export async function renderAboutSettingsSection(): Promise<void> {
  const mount = clearMount('settingsAboutBody');
  if (!mount) return;

  const serverUp = await detectConfigServer();
  if (!serverUp) {
    appendSettingsOfflineHint(
      mount,
      'Diagnostics require <code>npm start</code>. Crash logs may still exist under <code>~/.minnow/logs/</code>.',
    );
  }

  let health: DiagnosticsHealthPayload | null = null;
  if (serverUp) {
    health = await fetchDiagnosticsHealth();
  }

  const about = appendSettingsGroup(
    mount,
    'About',
    'Local-first diagnostics — nothing is sent off-device.',
    'about.info',
  );

  const version = health?.version ?? '—';
  const platform = health?.platform ?? navigator.platform;
  const nodeVersion = health?.nodeVersion ?? '—';
  const electronVersion = health?.electronVersion ?? (window.minnow ? 'desktop' : '—');

  const kv = el('dl', 'settings-kv-list');
  for (const [term, value] of [
    ['App version', version],
    ['Platform', platform],
    ['Node', nodeVersion],
    ['Electron', electronVersion],
    ['Storage', '~/.minnow'],
  ]) {
    const dt = el('dt', '', term);
    const dd = el('dd', '', value);
    kv.append(dt, dd);
  }
  about.appendChild(kv);

  const healthGroup = appendSettingsGroup(
    mount,
    'Health',
    'Subsystem probes — same checks as the status strip.',
    'about.health',
  );
  const healthHost = el('div', 'diagnostics-health-host');
  healthGroup.appendChild(healthHost);

  const diagnostics = appendSettingsGroup(
    mount,
    'Diagnostics',
    'Recent errors grouped by signature, plus a rotating local log tail.',
    'about.diagnostics',
  );

  let activeFilter: SourceFilter = 'all';
  const filterHost = el('div', 'diagnostics-filter-host');
  const errorsHost = el('div', 'diagnostics-errors-host');
  const logsHost = el('div', 'diagnostics-logs-host');
  diagnostics.append(filterHost, errorsHost, logsHost);

  const actions = createSettingsActionsRow(
    [
      {
        label: 'Copy report',
        variant: 'primary',
        onClick: () => {
          void (async () => {
            try {
              const res = await fetch('/api/diagnostics/report', { cache: 'no-store' });
              if (!res.ok) throw new Error('Report unavailable');
              const body = (await res.json()) as { markdown?: string };
              const text = body.markdown ?? '';
              await navigator.clipboard.writeText(text);
              setStatus('ok', 'Diagnostic report copied');
            } catch {
              setStatus('err', 'Could not copy report');
            }
          })();
        },
      },
      {
        label: 'Refresh',
        onClick: () => {
          void refreshViewer();
        },
      },
    ],
    { searchKey: 'about.diagnostics.actions' },
  );
  diagnostics.appendChild(actions);

  const scrollToErrors = (): void => {
    errorsHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  async function refreshViewer(): Promise<void> {
    if (serverUp) {
      health = await fetchDiagnosticsHealth();
      renderHealthStrip(healthHost, health, { onErrorClick: scrollToErrors });
    } else {
      healthHost.replaceChildren();
      healthHost.appendChild(el('p', 'diagnostics-empty', 'Server offline'));
    }

    try {
      const [errors, logs] = await Promise.all([
        serverUp ? fetchDiagnosticErrors(activeFilter) : Promise.resolve([]),
        serverUp ? fetchDiagnosticLogs(activeFilter) : Promise.resolve([]),
      ]);
      renderErrorList(errorsHost, errors);
      renderLogTail(logsHost, logs);
    } catch {
      errorsHost.replaceChildren();
      errorsHost.appendChild(el('p', 'diagnostics-empty', 'Could not load diagnostics.'));
    }
  }

  filterHost.replaceChildren();
  filterHost.appendChild(
    renderFilterRow((source) => {
      activeFilter = source;
      void refreshViewer();
    }, activeFilter),
  );

  renderHealthStrip(healthHost, health, { onErrorClick: scrollToErrors });
  await refreshViewer();
}
