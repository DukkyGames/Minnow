/**
 * Settings → Servers — managed local servers (SearXNG install, lifecycle, logs).
 */

import {
  fetchManagedServerLogs,
  fetchManagedServers,
  fetchServerInstallStatus,
  installManagedServer,
  restartManagedServer,
  setManagedServerAutoStart,
  setManagedServerEnabled,
  setManagedServerPort,
  startManagedServer,
  stopManagedServer,
  uninstallManagedServer,
  type ManagedServerSummary,
  type ServerInstallJob,
  type ServerRuntimePhase,
} from '../servers/client';
import {
  fetchLlamaRuntime,
  installLlamaRuntime,
  listModelServes,
  stopModelServe,
  type ServeRecord,
} from '../models/api-client';
import { appendSettingsCrosslinks } from './settings-layout';
import { createSettingsSwitch } from './settings-switch';
import { setStatus } from './status';
import { isLocalServerAvailable } from '../tools/config';

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

const PHASE_LABELS: Record<ServerRuntimePhase, string> = {
  pending: 'Not installed',
  installing: 'Installing…',
  starting: 'Starting…',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

/** Human-readable status for the server row dot line. */
function describeServerStatus(server: ManagedServerSummary): {
  ok: boolean;
  text: string;
} {
  if (server.job?.phase === 'installing') {
    return {
      ok: false,
      text: server.job.message || `Installing (${server.job.percent}%)`,
    };
  }
  if (server.running) {
    return { ok: true, text: `Running on http://127.0.0.1:${server.port}` };
  }
  if (server.installed) {
    return {
      ok: false,
      text: PHASE_LABELS[server.phase] ?? server.phase,
    };
  }
  return { ok: false, text: PHASE_LABELS.pending };
}

/** Poll install job until done, error, or timeout. */
async function pollInstallJob(
  serverId: string,
  onTick: (job: ServerInstallJob | null) => void,
  maxMs = 600_000,
): Promise<'done' | 'error' | 'timeout'> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const job = await fetchServerInstallStatus(serverId);
    onTick(job);
    if (job?.phase === 'done') return 'done';
    if (job?.phase === 'error') return 'error';
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout';
}

/** llama.cpp row — runtime install + active model serves (no port/auto-start). */
function createLlamaCppServerRow(
  server: ManagedServerSummary,
  onRefresh: () => void,
): HTMLElement {
  const row = document.createElement('article');
  row.className = 'settings-mcp-row';
  row.setAttribute('role', 'listitem');
  row.dataset.serverId = server.id;

  const head = el('div', 'settings-mcp-row-head');
  head.append(el('span', 'settings-mcp-name', server.label));
  head.append(el('span', 'settings-mcp-badge settings-mcp-badge--builtin', 'Runtime'));
  row.append(head);

  const detail = el('div', 'settings-mcp-detail');
  if (server.description) {
    detail.append(el('p', 'settings-mcp-desc', server.description));
  }

  const runtimeInfo = el('p', 'settings-mcp-hint', 'Loading runtime…');
  runtimeInfo.dataset.llamaRuntimeInfo = server.id;
  detail.append(runtimeInfo);

  const variantField = el('div', 'settings-field');
  variantField.append(el('label', 'settings-field-label', 'Variant'));
  const variantSelect = el('select', 'settings-input') as HTMLSelectElement;
  variantSelect.dataset.llamaVariant = server.id;
  variantField.appendChild(variantSelect);
  detail.append(variantField);

  const actions = el('div', 'settings-server-actions');
  const installBtn = el('button', 'settings-action-btn', server.installed ? 'Reinstall' : 'Install');
  installBtn.type = 'button';
  installBtn.dataset.llamaInstall = server.id;
  actions.append(installBtn);
  detail.append(actions);

  const servesPanel = el('details', 'settings-server-logs');
  servesPanel.open = true;
  const servesSummary = el('summary', undefined, 'Active model serves');
  const servesList = el('div', 'settings-llama-serves-list');
  servesList.dataset.llamaServesList = server.id;
  servesPanel.append(servesSummary, servesList);
  detail.append(servesPanel);

  row.append(detail);

  const refreshRuntime = async (): Promise<void> => {
    try {
      const runtime = await fetchLlamaRuntime();
      runtimeInfo.textContent = runtime.path
        ? `${runtime.variant ?? 'cpu'} · ${runtime.version} · ${runtime.path}`
        : `Not installed — recommended: ${runtime.preferredVariant}`;

      variantSelect.replaceChildren();
      for (const v of runtime.installableVariants) {
        const opt = el('option', undefined, v) as HTMLOptionElement;
        opt.value = v;
        if (v === (runtime.variant ?? runtime.preferredVariant)) opt.selected = true;
        variantSelect.appendChild(opt);
      }
    } catch (err) {
      runtimeInfo.textContent =
        err instanceof Error ? err.message : 'Could not load llama.cpp runtime';
    }
  };

  const refreshServes = async (): Promise<void> => {
    const serves = await listModelServes();
    const active = serves.filter(
      (s: ServeRecord) =>
        s.runtime === 'llama-cpp' && (s.status === 'running' || s.status === 'starting'),
    );
    servesList.replaceChildren();
    if (!active.length) {
      servesList.appendChild(
        el('p', 'settings-field-hint', 'No active serves — use Models → Installed.'),
      );
      return;
    }
    for (const serve of active) {
      const item = el('div', 'settings-llama-serve-row');
      item.append(el('span', undefined, `${serve.modelLabel} · :${serve.port}`));
      const stopBtn = el('button', 'settings-inline-btn', 'Stop');
      stopBtn.type = 'button';
      stopBtn.addEventListener('click', () => {
        void stopModelServe(serve.id).then(() => {
          setStatus('ok', 'Serve stopped');
          void refreshServes();
          onRefresh();
        });
      });
      item.appendChild(stopBtn);
      servesList.appendChild(item);
    }
  };

  installBtn.addEventListener('click', () => {
    void (async () => {
      installBtn.disabled = true;
      runtimeInfo.textContent = 'Installing…';
      try {
        await installLlamaRuntime({
          variant: variantSelect.value || undefined,
          reinstall: server.installed,
        });
        setStatus('ok', 'llama.cpp runtime installed');
        await refreshRuntime();
        onRefresh();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Install failed');
      } finally {
        installBtn.disabled = false;
      }
    })();
  });

  void refreshRuntime();
  void refreshServes();

  return row;
}

function createServerRow(
  server: ManagedServerSummary,
  onRefresh: () => void,
): HTMLElement {
  const row = document.createElement('article');
  row.className = 'settings-mcp-row';
  row.setAttribute('role', 'listitem');
  row.dataset.serverId = server.id;

  const head = el('div', 'settings-mcp-row-head');
  const toggleWrap = el('div', 'settings-mcp-toggle');
  const { root: enableSwitch, input: enableInput } = createSettingsSwitch({
    checked: server.enabled,
    ariaLabel: `${server.enabled ? 'Disable' : 'Enable'} ${server.label}`,
  });
  enableInput.dataset.serverEnable = server.id;
  const title = el('span', 'settings-mcp-name', server.label);
  toggleWrap.append(enableSwitch, title);
  head.append(toggleWrap);

  const badge = el('span', 'settings-mcp-badge settings-mcp-badge--builtin', 'Managed');
  head.append(badge);
  row.append(head);

  const detail = el('div', 'settings-mcp-detail');
  if (server.description) {
    detail.append(el('p', 'settings-mcp-desc', server.description));
  }

  const statusInfo = describeServerStatus(server);
  const status = el(
    'span',
    `settings-mcp-status ${statusInfo.ok ? 'settings-mcp-status--ok' : 'settings-mcp-status--idle'}`,
  );
  status.append(
    el('span', 'settings-mcp-status-dot'),
    el('span', 'settings-mcp-status-text', statusInfo.text),
  );
  detail.append(status);

  const installProgress = el('p', 'settings-mcp-hint settings-server-install-progress hidden');
  installProgress.dataset.serverInstallProgress = server.id;
  detail.append(installProgress);

  const controls = el('div', 'settings-server-controls');

  const autoRow = el('label', 'settings-inline-checkbox');
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = server.autoStart;
  autoCb.dataset.serverAutoStart = server.id;
  autoRow.append(autoCb, document.createTextNode(' Auto-start on npm start'));
  controls.append(autoRow);

  const portField = el('div', 'settings-field settings-server-port-field');
  const portLabel = el('label', 'settings-field-label', 'Port');
  portLabel.htmlFor = `settingsServerPort-${server.id}`;
  const portInput = document.createElement('input');
  portInput.type = 'number';
  portInput.id = `settingsServerPort-${server.id}`;
  portInput.className = 'settings-input';
  portInput.min = '1024';
  portInput.max = '65535';
  portInput.value = String(server.port);
  portInput.dataset.serverPort = server.id;
  const portApply = el('button', 'settings-inline-btn', 'Apply port');
  portApply.type = 'button';
  portApply.dataset.serverPortApply = server.id;
  portField.append(portLabel, portInput, portApply);
  controls.append(portField);

  const actions = el('div', 'settings-server-actions');
  if (!server.installed) {
    const installBtn = el('button', 'settings-action-btn', 'Install');
    installBtn.type = 'button';
    installBtn.dataset.serverInstall = server.id;
    actions.append(installBtn);
  } else {
    if (!server.running) {
      const startBtn = el('button', 'settings-action-btn', 'Start');
      startBtn.type = 'button';
      startBtn.dataset.serverStart = server.id;
      actions.append(startBtn);
    } else {
      const stopBtn = el('button', 'settings-inline-btn', 'Stop');
      stopBtn.type = 'button';
      stopBtn.dataset.serverStop = server.id;
      actions.append(stopBtn);
      const restartBtn = el('button', 'settings-inline-btn', 'Restart');
      restartBtn.type = 'button';
      restartBtn.dataset.serverRestart = server.id;
      actions.append(restartBtn);
    }
    const uninstallBtn = el('button', 'settings-inline-btn settings-mcp-remove', 'Uninstall');
    uninstallBtn.type = 'button';
    uninstallBtn.dataset.serverUninstall = server.id;
    actions.append(uninstallBtn);
  }
  controls.append(actions);
  detail.append(controls);

  const logsPanel = document.createElement('details');
  logsPanel.className = 'settings-server-logs';
  const logsSummary = document.createElement('summary');
  logsSummary.textContent = 'Logs';
  const logsPre = document.createElement('pre');
  logsPre.className = 'settings-server-logs__body';
  logsPre.dataset.serverLogs = server.id;
  logsPre.textContent = '(expand to load)';
  const logsRefresh = el('button', 'settings-inline-btn', 'Refresh logs');
  logsRefresh.type = 'button';
  logsRefresh.dataset.serverLogsRefresh = server.id;
  logsPanel.append(logsSummary, logsRefresh, logsPre);
  detail.append(logsPanel);

  row.append(detail);

  enableInput.addEventListener('change', () => {
    void (async () => {
      const ok = await setManagedServerEnabled(server.id, enableInput.checked);
      if (ok) {
        setStatus('ok', enableInput.checked ? `${server.label} enabled` : `${server.label} disabled`);
        onRefresh();
        return;
      }
      enableInput.checked = !enableInput.checked;
      setStatus('err', 'Could not update server — use npm start');
    })();
  });

  autoCb.addEventListener('change', () => {
    void (async () => {
      const ok = await setManagedServerAutoStart(server.id, autoCb.checked);
      if (ok) {
        setStatus('ok', autoCb.checked ? 'Auto-start enabled' : 'Auto-start disabled');
        return;
      }
      autoCb.checked = !autoCb.checked;
      setStatus('err', 'Could not save auto-start');
    })();
  });

  portApply.addEventListener('click', () => {
    void (async () => {
      const port = Number(portInput.value);
      const result = await setManagedServerPort(server.id, port);
      if (result.ok) {
        portInput.value = String(result.port);
        setStatus('ok', `Port set to ${result.port}`);
        onRefresh();
        return;
      }
      setStatus('err', result.ok === false ? result.error : 'Invalid port');
    })();
  });

  const installBtn = actions.querySelector<HTMLButtonElement>(`[data-server-install="${server.id}"]`);
  installBtn?.addEventListener('click', () => {
    void (async () => {
      installBtn.disabled = true;
      installProgress.classList.remove('hidden');
      installProgress.textContent = 'Starting install…';

      const pollPromise = pollInstallJob(server.id, (job) => {
        if (job?.phase === 'installing' || job?.phase === 'pending') {
          installProgress.textContent =
            job.message || `Installing… ${job.percent}%`;
        }
      });

      const result = await installManagedServer(server.id);
      if (result.ok === false) {
        installBtn.disabled = false;
        installProgress.classList.add('hidden');
        setStatus('err', result.error);
        return;
      }
      if (result.alreadyInstalled) {
        installProgress.classList.add('hidden');
        installBtn.disabled = false;
        setStatus('ok', 'Already installed');
        onRefresh();
        return;
      }

      const pollResult = await pollPromise;
      installProgress.classList.add('hidden');
      installBtn.disabled = false;
      if (pollResult === 'done') {
        setStatus('ok', `${server.label} installed`);
        onRefresh();
        return;
      }
      if (pollResult === 'error') {
        const lastJob = await fetchServerInstallStatus(server.id);
        const detail = lastJob?.error?.trim() || lastJob?.message?.trim();
        setStatus('err', detail ? `Install failed: ${detail}` : 'Install failed — see logs');
        onRefresh();
        return;
      }
      setStatus('err', 'Install timed out — check logs');
      onRefresh();
    })();
  });

  actions.querySelector<HTMLButtonElement>(`[data-server-start="${server.id}"]`)?.addEventListener(
    'click',
    () => {
      void (async () => {
        const result = await startManagedServer(server.id);
        if (result.ok) {
          setStatus('ok', `${server.label} started`);
          onRefresh();
          return;
        }
        setStatus('err', result.ok === false ? result.error : 'Start failed');
      })();
    },
  );

  actions.querySelector<HTMLButtonElement>(`[data-server-stop="${server.id}"]`)?.addEventListener(
    'click',
    () => {
      void (async () => {
        const result = await stopManagedServer(server.id);
        if (result.ok) {
          setStatus('ok', `${server.label} stopped`);
          onRefresh();
          return;
        }
        setStatus('err', result.ok === false ? result.error : 'Stop failed');
      })();
    },
  );

  actions.querySelector<HTMLButtonElement>(`[data-server-restart="${server.id}"]`)?.addEventListener(
    'click',
    () => {
      void (async () => {
        const result = await restartManagedServer(server.id);
        if (result.ok) {
          setStatus('ok', `${server.label} restarted`);
          onRefresh();
          return;
        }
        setStatus('err', result.ok === false ? result.error : 'Restart failed');
      })();
    },
  );

  actions.querySelector<HTMLButtonElement>(`[data-server-uninstall="${server.id}"]`)?.addEventListener(
    'click',
    () => {
      if (!confirm(`Uninstall ${server.label}? This removes files under ~/.minnow/servers/.`)) {
        return;
      }
      void (async () => {
        const ok = await uninstallManagedServer(server.id);
        if (ok) {
          setStatus('ok', `${server.label} uninstalled`);
          onRefresh();
          return;
        }
        setStatus('err', 'Uninstall failed');
      })();
    },
  );

  const loadLogs = (): void => {
    void (async () => {
      logsPre.textContent = 'Loading…';
      const lines = await fetchManagedServerLogs(server.id);
      logsPre.textContent =
        lines && lines.length > 0 ? lines.join('\n') : '(no log lines yet)';
    })();
  };

  logsPanel.addEventListener('toggle', () => {
    if (logsPanel.open) loadLogs();
  });
  logsRefresh.addEventListener('click', (e) => {
    e.preventDefault();
    loadLogs();
  });

  return row;
}

/** Render Settings → Servers into the section mount. */
export async function renderServersSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  mount.appendChild(
    el(
      'p',
      'settings-section-note',
      'Install and run local services under ~/.minnow/servers/. Requires npm start. When SearXNG is enabled and running, Search and Deep Research use the managed instance instead of the URL in search.json.',
    ),
  );

  const offlineBanner = el(
    'p',
    'settings-server-banner',
    'Start with npm start to install, start, and configure managed servers.',
  );
  offlineBanner.id = 'settingsServersOffline';
  if (isLocalServerAvailable()) {
    offlineBanner.classList.add('hidden');
  }
  mount.appendChild(offlineBanner);

  const list = el('div', 'settings-mcp-list');
  list.id = 'settingsManagedServerList';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Managed servers');
  mount.appendChild(list);

  const refresh = async (): Promise<void> => {
    if (!isLocalServerAvailable()) {
      list.replaceChildren();
      offlineBanner.classList.remove('hidden');
      return;
    }
    offlineBanner.classList.add('hidden');
    const servers = await fetchManagedServers();
    list.replaceChildren();
    if (servers === null) {
      list.appendChild(el('p', 'settings-field-hint', 'Could not load servers.'));
      return;
    }
    if (servers.length === 0) {
      list.appendChild(el('p', 'settings-field-hint', 'No managed servers in catalog.'));
      return;
    }
    for (const server of servers) {
      list.appendChild(
        server.id === 'llama-cpp'
          ? createLlamaCppServerRow(server, () => void refresh())
          : createServerRow(server, () => void refresh()),
      );
    }
  };

  await refresh();

  appendSettingsCrosslinks(mount, [
    { label: 'Search provider', sectionId: 'search' },
    { label: 'Deep Research', sectionId: 'deep-research' },
  ]);
}
