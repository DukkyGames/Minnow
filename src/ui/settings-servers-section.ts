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
  fetchRouterStatus,
  fetchLlamaCppConfig,
  installLlamaRuntime,
  restartModelRouter,
  rollbackLlamaRuntime,
  saveLlamaCppConfig,
  startModelRouter,
  stopModelRouter,
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

/** Compact status pill label + optional mono endpoint for managed server rows. */
function describeServerStatus(server: ManagedServerSummary): {
  ok: boolean;
  pill: string;
  endpoint: string | null;
} {
  if (server.job?.phase === 'installing') {
    return {
      ok: false,
      pill: 'Installing',
      endpoint: server.job.message || `${server.job.percent}%`,
    };
  }
  if (server.running) {
    return {
      ok: true,
      pill: 'Running',
      endpoint: `http://127.0.0.1:${server.port}`,
    };
  }
  if (server.installed) {
    return {
      ok: false,
      pill: PHASE_LABELS[server.phase] ?? server.phase,
      endpoint: null,
    };
  }
  return { ok: false, pill: PHASE_LABELS.pending, endpoint: null };
}

/** Status pill matching LSP row instrumentation (semantic green only when running). */
function createServerStatusPill(label: string, ok: boolean): HTMLElement {
  const pill = el(
    'span',
    `settings-lsp-pill ${ok ? 'settings-lsp-pill--running' : 'settings-lsp-pill--off'}`,
    label,
  );
  pill.setAttribute('aria-label', label);
  return pill;
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
  const identity = el('div', 'settings-mcp-row-identity');
  identity.append(el('span', 'settings-mcp-name', server.label));
  if (server.description) {
    const desc = el('span', 'settings-mcp-row-desc');
    desc.textContent = server.description;
    desc.title = server.description;
    identity.append(desc);
  }
  const headMeta = el('div', 'settings-mcp-row-head-meta');
  const installPill = createServerStatusPill(
    server.installed ? 'Installed' : 'Not installed',
    server.installed,
  );
  installPill.dataset.llamaInstallPill = server.id;
  headMeta.append(
    installPill,
    el('span', 'settings-mcp-badge settings-mcp-badge--builtin', 'Runtime'),
  );
  head.append(identity, headMeta);
  row.append(head);

  const body = el('div', 'settings-mcp-row-body');
  const runtimeInfo = el('p', 'settings-mcp-hint', 'Loading runtime…');
  runtimeInfo.dataset.llamaRuntimeInfo = server.id;
  body.append(runtimeInfo);

  const toolbar = el('div', 'settings-server-toolbar');
  const variantLabel = el('span', 'settings-server-toolbar__label', 'Variant');
  const variantSelect = el('select', 'settings-select settings-server-variant-select') as HTMLSelectElement;
  variantSelect.dataset.llamaVariant = server.id;
  const installBtn = el('button', 'settings-action-btn', server.installed ? 'Reinstall' : 'Install');
  installBtn.type = 'button';
  installBtn.dataset.llamaInstall = server.id;
  const updateBtn = el('button', 'settings-inline-btn hidden', 'Update');
  updateBtn.type = 'button';
  updateBtn.dataset.llamaUpdate = server.id;
  const rollbackBtn = el('button', 'settings-inline-btn hidden', 'Rollback');
  rollbackBtn.type = 'button';
  rollbackBtn.dataset.llamaRollback = server.id;
  toolbar.append(variantLabel, variantSelect, installBtn, updateBtn, rollbackBtn);
  body.append(toolbar);

  const routerPolicy = el('div', 'settings-server-toolbar settings-llama-router-policy');
  const modelsMaxLabel = el('label', 'settings-server-toolbar__label', 'Model slots');
  const modelsMaxInput = el('input', 'settings-input settings-llama-models-max') as HTMLInputElement;
  modelsMaxInput.type = 'number';
  modelsMaxInput.min = '1';
  modelsMaxInput.max = '8';
  modelsMaxInput.dataset.llamaModelsMax = server.id;
  const lifecycleLabel = el('label', 'settings-server-toolbar__label', 'Lifecycle');
  const lifecycleSelect = el('select', 'settings-select settings-llama-lifecycle') as HTMLSelectElement;
  lifecycleSelect.dataset.llamaLifecycle = server.id;
  for (const value of ['on-demand', 'always', 'off'] as const) {
    const opt = el('option', undefined, value) as HTMLOptionElement;
    opt.value = value;
    lifecycleSelect.appendChild(opt);
  }
  const policyApplyBtn = el('button', 'settings-inline-btn', 'Apply router policy');
  policyApplyBtn.type = 'button';
  policyApplyBtn.dataset.llamaPolicyApply = server.id;
  routerPolicy.append(
    modelsMaxLabel,
    modelsMaxInput,
    lifecycleLabel,
    lifecycleSelect,
    policyApplyBtn,
  );
  body.append(routerPolicy);

  const routerPanel = el('details', 'settings-server-logs');
  const routerSummary = el('summary', undefined, 'Router');
  const routerBody = el('div', 'settings-llama-router-body');
  routerBody.dataset.llamaRouterBody = server.id;
  routerPanel.append(routerSummary, routerBody);
  body.append(routerPanel);

  row.append(body);

  const refreshRuntime = async (): Promise<void> => {
    try {
      const runtime = await fetchLlamaRuntime();
      const installed = Boolean(runtime.path);
      installPill.textContent = installed ? 'Installed' : 'Not installed';
      installPill.classList.toggle('settings-lsp-pill--running', installed);
      installPill.classList.toggle('settings-lsp-pill--off', !installed);
      installBtn.textContent = installed ? 'Reinstall' : 'Install';

      runtimeInfo.textContent = runtime.path
        ? `${runtime.variant ?? 'cpu'} · ${runtime.version}${runtime.latestTag ? ` (latest ${runtime.latestTag})` : ''} · ${runtime.path}`
        : `Recommended variant: ${runtime.preferredVariant}`;

      updateBtn.classList.toggle('hidden', !runtime.updateAvailable);
      rollbackBtn.classList.toggle('hidden', !runtime.canRollback);

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

  const refreshRouterPolicy = async (): Promise<void> => {
    try {
      const [config, { router }] = await Promise.all([
        fetchLlamaCppConfig(),
        fetchRouterStatus(),
      ]);
      modelsMaxInput.value = String(config.router?.modelsMax ?? router.modelsMax ?? 1);
      lifecycleSelect.value = config.router?.lifecycle ?? 'on-demand';
    } catch {
      modelsMaxInput.value = '1';
      lifecycleSelect.value = 'on-demand';
    }
  };

  const refreshRouter = async (): Promise<void> => {
    routerBody.replaceChildren();
    try {
      const { router, loadedModels } = await fetchRouterStatus();
      const statusLine = el('p', 'settings-mcp-hint');
      if (!router.routerSupported) {
        statusLine.textContent = 'Router mode unavailable — reinstall or update the managed runtime.';
      } else {
        const loaded = loadedModels?.data?.length ?? 0;
        statusLine.textContent = `${router.status} · port ${router.port} · ${loaded}/${router.modelsMax} slots`;
      }
      routerBody.appendChild(statusLine);

      if (router.error) {
        routerBody.appendChild(el('p', 'settings-field-hint settings-llama-router-error', router.error));
      }

      const actions = el('div', 'settings-server-actions');
      if (router.routerSupported) {
        if (router.status === 'running' || router.status === 'starting') {
          const stopBtn = el('button', 'settings-inline-btn', 'Stop');
          stopBtn.type = 'button';
          stopBtn.addEventListener('click', () => {
            void stopModelRouter().then(() => {
              setStatus('ok', 'Router stopped');
              void refreshRouter();
              onRefresh();
            });
          });
          const restartBtn = el('button', 'settings-inline-btn', 'Restart');
          restartBtn.type = 'button';
          restartBtn.addEventListener('click', () => {
            void restartModelRouter().then(() => {
              setStatus('ok', 'Router restarted');
              void refreshRouter();
              onRefresh();
            });
          });
          actions.append(stopBtn, restartBtn);
        } else {
          const startBtn = el('button', 'settings-action-btn', 'Start router');
          startBtn.type = 'button';
          startBtn.addEventListener('click', () => {
            void startModelRouter().then(() => {
              setStatus('ok', 'Router started');
              void refreshRouter();
              onRefresh();
            });
          });
          actions.append(startBtn);
        }
      }
      routerBody.appendChild(actions);

      const models = loadedModels?.data ?? [];
      if (models.length) {
        const list = el('ul', 'settings-llama-loaded-models');
        for (const m of models) {
          const item = el('li', undefined, m.id);
          list.appendChild(item);
        }
        routerBody.appendChild(list);
      }
    } catch (err) {
      routerBody.appendChild(
        el(
          'p',
          'settings-field-hint',
          err instanceof Error ? err.message : 'Could not load router status',
        ),
      );
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

  updateBtn.addEventListener('click', () => {
    void (async () => {
      updateBtn.disabled = true;
      runtimeInfo.textContent = 'Updating…';
      try {
        await installLlamaRuntime({
          variant: variantSelect.value || undefined,
          update: true,
        });
        setStatus('ok', 'llama.cpp runtime updated');
        await refreshRuntime();
        await refreshRouter();
        onRefresh();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Update failed');
      } finally {
        updateBtn.disabled = false;
      }
    })();
  });

  rollbackBtn.addEventListener('click', () => {
    void (async () => {
      rollbackBtn.disabled = true;
      try {
        await rollbackLlamaRuntime();
        setStatus('ok', 'Rolled back to previous llama.cpp runtime');
        await refreshRuntime();
        await refreshRouter();
        onRefresh();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Rollback failed');
      } finally {
        rollbackBtn.disabled = false;
      }
    })();
  });

  policyApplyBtn.addEventListener('click', () => {
    void (async () => {
      const modelsMax = Number(modelsMaxInput.value);
      const lifecycle = lifecycleSelect.value as 'off' | 'on-demand' | 'always';
      try {
        await saveLlamaCppConfig({
          router: { modelsMax, lifecycle },
        });
        if (lifecycle !== 'off') {
          await restartModelRouter();
        }
        setStatus('ok', 'Router policy saved');
        await refreshRouter();
        onRefresh();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Could not save router policy');
      }
    })();
  });

  void refreshRuntime();
  void refreshRouterPolicy();
  void refreshRouter();

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
  const identity = el('div', 'settings-mcp-row-identity');
  identity.append(el('span', 'settings-mcp-name', server.label));
  if (server.description) {
    const desc = el('span', 'settings-mcp-row-desc');
    desc.textContent = server.description;
    desc.title = server.description;
    identity.append(desc);
  }
  toggleWrap.append(enableSwitch);
  head.append(toggleWrap, identity);

  const statusInfo = describeServerStatus(server);
  const headMeta = el('div', 'settings-mcp-row-head-meta');
  headMeta.append(
    createServerStatusPill(statusInfo.pill, statusInfo.ok),
    el('span', 'settings-mcp-badge settings-mcp-badge--builtin', 'Managed'),
  );
  head.append(headMeta);
  row.append(head);

  const body = el('div', 'settings-mcp-row-body');
  if (statusInfo.endpoint) {
    const endpoint = el('p', 'settings-mcp-hint settings-server-endpoint');
    endpoint.textContent = statusInfo.endpoint;
    body.append(endpoint);
  }

  const installProgress = el('p', 'settings-mcp-hint settings-server-install-progress hidden');
  installProgress.dataset.serverInstallProgress = server.id;
  body.append(installProgress);

  const toolbar = el('div', 'settings-server-toolbar');
  const autoRow = el('label', 'settings-inline-checkbox settings-server-auto-start');
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = server.autoStart;
  autoCb.dataset.serverAutoStart = server.id;
  autoRow.append(autoCb, document.createTextNode('Auto-start on npm start'));
  toolbar.append(autoRow);

  const portInline = el('div', 'settings-server-port-inline');
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
  const portApply = el('button', 'settings-inline-btn', 'Apply');
  portApply.type = 'button';
  portApply.dataset.serverPortApply = server.id;
  portInline.append(portLabel, portInput, portApply);
  toolbar.append(portInline);

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
  toolbar.append(actions);
  body.append(toolbar);

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
  body.append(logsPanel);

  row.append(body);

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
