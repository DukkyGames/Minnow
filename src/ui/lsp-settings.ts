/**
 * Language servers settings page: grouped panels, MCP-style server rows, custom LSP form.
 */

import {
  fetchLspBundles,
  fetchLspBundleProgress,
  fetchLspConfig,
  installLspBundle,
  saveLspConfig,
  uninstallLspBundle,
  type LspBundleJob,
  type LspBundleStatus,
  type LspServerStatus,
} from '../lsp/config-client';
import { detectLocalServer } from '../tools/client';
import { isLocalServerAvailable } from '../tools/config';
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { createSettingsSwitch, createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';

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

function serverBanner(message: string): HTMLElement {
  const p = el('p', 'settings-server-banner');
  p.setAttribute('role', 'status');
  p.innerHTML = message;
  return p;
}

/** Hide test-only fake server from the settings list. */
function visibleServers(servers: LspServerStatus[]): LspServerStatus[] {
  return servers.filter((s) => s.id !== 'fake');
}

function sortServers(servers: LspServerStatus[]): LspServerStatus[] {
  return [...servers].sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
}

/** Format install requirements for a hint line under the server row. */
function formatRequirementsHint(
  requirements: LspServerStatus['requirements'],
): string | null {
  if (!requirements) return null;
  const bits: string[] = [];
  if (requirements.package) bits.push(`npm: ${requirements.package}`);
  if (requirements.binary) bits.push(`binary: ${requirements.binary}`);
  if (requirements.command) bits.push(`command: ${requirements.command}`);
  if (bits.length === 0) return null;
  return bits.join(' · ');
}

function parseCommaList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function appendSummaryKv(
  mount: HTMLElement,
  rows: Array<{ term: string; value: string }>,
): void {
  const dl = el('dl', 'settings-kv');
  for (const { term, value } of rows) {
    dl.append(el('dt', 'settings-kv__term', term), el('dd', 'settings-kv__value', value));
  }
  mount.append(dl);
}

function createLspSettingsRow(
  server: LspServerStatus,
  onToggle: (id: string, enabled: boolean) => void,
  onDelete: (id: string) => void,
): HTMLElement {
  const row = el('article', 'settings-lsp-row');
  row.setAttribute('role', 'listitem');
  row.dataset.serverId = server.id;

  const main = el('div', 'settings-lsp-row-main');

  const labelWrap = el('div', 'settings-lsp-toggle');
  const { root: switchRoot } = createSettingsSwitch({
    checked: !server.disabled,
    ariaLabel: `${server.disabled ? 'Enable' : 'Disable'} ${server.label}`,
    onChange: (enabled) => onToggle(server.id, enabled),
  });

  labelWrap.append(switchRoot, el('span', 'settings-lsp-name', server.label));
  main.append(labelWrap);

  if (server.extensions.length > 0) {
    const ext = el('span', 'settings-lsp-extensions');
    ext.textContent = server.extensions.join(' ');
    ext.title = server.extensions.join(', ');
    main.append(ext);
  }

  const status = el(
    'span',
    `settings-lsp-status ${server.running ? 'settings-lsp-status--ok' : 'settings-lsp-status--idle'}`,
  );
  status.setAttribute(
    'aria-label',
    server.running ? 'Language server process running' : 'Language server idle',
  );
  status.append(el('span', 'settings-lsp-status-dot'));
  main.append(status);

  const reqHint = formatRequirementsHint(server.requirements);
  if (server.disabledReason) {
    const warn = el('span', 'settings-lsp-warn', server.disabledReason);
    if (reqHint) warn.title = reqHint;
    main.append(warn);
  } else if (reqHint) {
    const hint = el('span', 'settings-lsp-hint', reqHint);
    hint.title = reqHint;
    main.append(hint);
  }

  if (server.builtin) {
    main.append(el('span', 'settings-lsp-badge settings-lsp-badge--builtin', 'Built-in'));
  } else {
    const removeBtn = el('button', 'settings-inline-btn settings-lsp-remove', 'Remove');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${server.label}`);
    removeBtn.addEventListener('click', () => onDelete(server.id));
    main.append(removeBtn);
  }

  row.append(main);
  return row;
}

function buildCustomServerForm(onAdded: () => void): HTMLFormElement {
  const form = el('form', 'settings-lsp-form');
  form.setAttribute('aria-label', 'Add custom language server');
  form.noValidate = true;

  const idRow = el('div', 'field-row');
  const idField = el('div', 'field');
  idField.append(el('label', '', 'Server id'));
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.name = 'id';
  idInput.required = true;
  idInput.autocomplete = 'off';
  idInput.spellcheck = false;
  idInput.placeholder = 'my-lsp';
  idInput.pattern = '[a-z0-9][a-z0-9._-]*';
  idInput.title = 'Lowercase letters, numbers, dots, hyphens, underscores';
  idField.append(
    idInput,
    el('p', 'field-hint', 'Lowercase letters, numbers, dots, hyphens, underscores.'),
  );
  idRow.append(idField);

  const labelField = el('div', 'field');
  labelField.append(el('label', '', 'Display name'));
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.name = 'label';
  labelInput.autocomplete = 'off';
  labelInput.placeholder = 'My Language Server';
  labelField.append(labelInput);
  idRow.append(labelField);
  form.append(idRow);

  const cmdField = el('div', 'field');
  cmdField.append(el('label', '', 'Command'));
  const cmdInput = document.createElement('input');
  cmdInput.type = 'text';
  cmdInput.name = 'command';
  cmdInput.required = true;
  cmdInput.autocomplete = 'off';
  cmdInput.spellcheck = false;
  cmdInput.placeholder = 'my-lsp-server --stdio';
  cmdField.append(
    cmdInput,
    el('p', 'field-hint', 'One shell token per word; stdio transport is typical.'),
  );
  form.append(cmdField);

  const extField = el('div', 'field');
  extField.append(el('label', '', 'File extensions'));
  const extInput = document.createElement('input');
  extInput.type = 'text';
  extInput.name = 'extensions';
  extInput.required = true;
  extInput.placeholder = '.foo, .bar';
  extField.append(
    extInput,
    el('p', 'field-hint', 'Comma-separated; leading dots are optional.'),
  );
  form.append(extField);

  const actions = el('div', 'settings-lsp-form-actions');
  const submit = el('button', 'settings-action-btn', 'Add server');
  submit.type = 'submit';
  const resetBtn = el('button', 'settings-inline-btn', 'Clear form');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => form.reset());
  actions.append(submit, resetBtn);
  form.append(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = idInput.value.trim().toLowerCase();
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
      setStatus('err', 'Invalid server id');
      return;
    }
    const command = cmdInput.value.trim().split(/\s+/).filter(Boolean);
    if (command.length === 0) {
      setStatus('err', 'Command is required');
      return;
    }
    const extensions = parseCommaList(extInput.value).map((e) =>
      e.startsWith('.') ? e : `.${e}`,
    );
    if (extensions.length === 0) {
      setStatus('err', 'At least one extension is required');
      return;
    }
    const label = labelInput.value.trim() || id;

    void saveLspConfig({
      lsp: {
        [id]: {
          disabled: false,
          command,
          extensions,
          label,
        },
      },
    }).then((ok) => {
      if (!ok) {
        setStatus('err', 'Failed to save custom LSP — use npm start');
        return;
      }
      setStatus('ok', `Added ${id}`);
      form.reset();
      onAdded();
    });
  });

  return form;
}

function appendCustomServerPanel(mount: HTMLElement, onAdded: () => void): void {
  const details = el('details', 'settings-lsp-add-panel');
  details.append(el('summary', 'settings-lsp-add-summary', 'Add custom language server'));
  details.append(buildCustomServerForm(onAdded));
  mount.append(details);
}

function formatBundleSize(bytes: number, estimateMb?: number): string {
  if (bytes > 0) {
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (estimateMb && estimateMb > 0) {
    return `~${estimateMb} MB`;
  }
  return '';
}

function createBundleCard(
  bundle: LspBundleStatus,
  onChanged: () => void,
): HTMLElement {
  const card = el('article', 'settings-lsp-bundle-card');
  card.dataset.bundleId = bundle.id;

  const head = el('div', 'settings-lsp-bundle-head');
  head.append(el('h4', 'settings-lsp-bundle-title', bundle.label));
  if (bundle.description) {
    head.append(el('p', 'settings-lsp-bundle-desc', bundle.description));
  }
  card.append(head);

  const meta = el('div', 'settings-lsp-bundle-meta');
  const sizeLabel = formatBundleSize(bundle.sizeBytes, bundle.sizeEstimateMb);
  if (bundle.installed && bundle.version) {
    meta.append(el('span', 'settings-lsp-bundle-version', `v${bundle.version}`));
  }
  if (sizeLabel) {
    meta.append(el('span', 'settings-lsp-bundle-size', sizeLabel));
  }
  if (bundle.prebundled) {
    meta.append(el('span', 'settings-lsp-badge settings-lsp-badge--builtin', 'Bundled'));
  }
  if (bundle.kind === 'binary') {
    meta.append(el('span', 'settings-lsp-bundle-kind', 'Binary download'));
  }
  card.append(meta);

  const progress = el('div', 'settings-lsp-bundle-progress');
  progress.hidden = true;
  const progressBar = el('div', 'settings-lsp-bundle-progress-bar');
  const progressFill = el('div', 'settings-lsp-bundle-progress-fill');
  progressBar.append(progressFill);
  const progressText = el('span', 'settings-lsp-bundle-progress-text');
  progress.append(progressBar, progressText);
  card.append(progress);

  const actions = el('div', 'settings-lsp-bundle-actions');
  const actionBtn = el(
    'button',
    'settings-action-btn settings-lsp-bundle-btn',
    bundle.installed ? 'Uninstall' : 'Install',
  );
  actionBtn.type = 'button';
  actionBtn.disabled = bundle.prebundled === true && bundle.installed;

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const stopPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const showProgress = (percent: number, message: string) => {
    progress.hidden = false;
    progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progressText.textContent = message;
  };

  const hideProgress = () => {
    progress.hidden = true;
    progressFill.style.width = '0%';
    progressText.textContent = '';
  };

  actionBtn.addEventListener('click', () => {
    void (async () => {
      actionBtn.disabled = true;
      if (bundle.installed && !bundle.prebundled) {
        const ok = await uninstallLspBundle(bundle.id);
        setStatus(ok ? 'ok' : 'err', ok ? `Removed ${bundle.label}` : 'Uninstall failed');
        stopPoll();
        hideProgress();
        onChanged();
        return;
      }
      if (bundle.installed) return;

      showProgress(0, 'Starting…');

      const handleInstallJob = (
        job: LspBundleJob | null | undefined,
        alreadyInstalled = false,
      ) => {
        if (!job) return false;
        if (job.phase === 'error') {
          setStatus('err', job.error ?? job.message ?? 'Install failed');
          stopPoll();
          hideProgress();
          actionBtn.disabled = false;
          onChanged();
          return true;
        }
        showProgress(job.percent, job.message || job.phase);
        if (job.phase === 'done') {
          setStatus(
            'ok',
            alreadyInstalled ? `${bundle.label} already installed` : `${bundle.label} installed`,
          );
          stopPoll();
          hideProgress();
          onChanged();
          return true;
        }
        return false;
      };

      const pollProgress = (alreadyInstalled: boolean) => {
        void fetchLspBundleProgress(bundle.id).then((payload) => {
          handleInstallJob(payload?.job, alreadyInstalled);
        });
      };

      const result = await installLspBundle(bundle.id);
      if (!result.ok) {
        setStatus('err', result.error ?? 'Install failed');
        hideProgress();
        actionBtn.disabled = false;
        return;
      }

      const alreadyInstalled = result.alreadyInstalled === true;
      if (
        handleInstallJob(
          await fetchLspBundleProgress(bundle.id).then((p) => p?.job),
          alreadyInstalled,
        )
      ) {
        return;
      }

      pollTimer = setInterval(() => pollProgress(alreadyInstalled), 500);
    })();
  });

  actions.append(actionBtn);
  card.append(actions);
  return card;
}

function appendLanguageBundlesPanel(mount: HTMLElement, refresh: () => void): void {
  const group = appendSettingsGroup(
    mount,
    'Language bundles',
    'Install language servers to ~/.minnow/lsp-servers. Lightweight servers ship with Minnow; heavy binaries download on demand.',
  );

  const loading = el('p', 'settings-field-hint', 'Loading bundles…');
  group.append(loading);

  void fetchLspBundles().then((data) => {
    loading.remove();
    if (!data?.categories?.length) {
      group.append(
        el('p', 'settings-field-hint', 'Could not load language bundles.'),
      );
      return;
    }

    for (const category of data.categories) {
      if (!category.bundles?.length) continue;
      const section = el('section', 'settings-lsp-bundle-category');
      section.append(el('h3', 'settings-lsp-bundle-category-title', category.label));
      const grid = el('div', 'settings-lsp-bundle-grid');
      grid.setAttribute('role', 'list');
      for (const bundle of category.bundles) {
        grid.append(createBundleCard(bundle, refresh));
      }
      section.append(grid);
      group.append(section);
    }
  });
}

function appendCrosslinks(mount: HTMLElement): void {
  const cross = el('div', 'settings-crosslinks');
  cross.append(el('span', 'settings-crosslinks__label', 'Related'));
  cross.append(
    linkToSettingsSection('Editor', 'editor'),
    linkToSettingsSection('Tools', 'tools'),
    linkToSettingsSection('MCP servers', 'mcp'),
  );
  mount.append(cross);
}

/** Render the full Language servers settings section into #settingsLspBody. */
export async function renderLspSection(): Promise<void> {
  const mount = document.getElementById('settingsLspBody');
  if (!mount) return;
  mount.replaceChildren();

  await detectLocalServer();
  const online = isLocalServerAvailable();
  if (!online) {
    mount.append(
      serverBanner(
        'Start with <code>npm start</code> to load server status, toggle analyzers, and save <code>~/.minnow/lsp.json</code>.',
      ),
    );
    return;
  }

  const config = await fetchLspConfig();
  if (!config) {
    mount.append(
      serverBanner('Could not load language server config. Confirm <code>npm start</code> is running.'),
    );
    return;
  }

  const servers = sortServers(visibleServers(config.servers));
  const enabledCount = servers.filter((s) => !s.disabled).length;
  const runningCount = servers.filter((s) => s.running).length;
  const masterOn = config.enabled !== false;

  const overview = appendSettingsGroup(
    mount,
    'Overview',
    'Master switch for all LSP processes. Individual servers can still be disabled below.',
  );

  const { row: masterRow } = createSettingsToggleRow('Enable language servers', {
    checked: masterOn,
    ariaLabel: 'Enable all language servers',
    onChange: (checked) => {
      void saveLspConfig({ enabled: checked }).then((ok) => {
        setStatus(
          ok ? 'ok' : 'err',
          ok ? 'Language servers updated' : 'Save failed — use npm start',
        );
        if (ok) void renderLspSection();
      });
    },
  });
  overview.append(masterRow);

  appendSummaryKv(overview, [
    { term: 'Configured', value: String(servers.length) },
    {
      term: 'Enabled',
      value: masterOn ? String(enabledCount) : '0 (master off)',
    },
    { term: 'Running', value: masterOn ? String(runningCount) : 'none' },
    { term: 'Storage', value: '~/.minnow/lsp.json' },
  ]);

  appendCrosslinks(overview);

  const refresh = () => {
    void renderLspSection();
  };

  appendLanguageBundlesPanel(mount, refresh);

  const setServerDisabled = async (id: string, enabled: boolean) => {
    const ok = await saveLspConfig({
      lsp: { [id]: { disabled: !enabled } },
    });
    if (ok) {
      setStatus('ok', enabled ? `${id} enabled` : `${id} disabled`);
      await renderLspSection();
      return;
    }
    setStatus('err', 'LSP save failed — use npm start');
    await renderLspSection();
  };

  const removeCustomServer = async (id: string) => {
    if (!confirm(`Remove language server "${id}"?`)) return;
    const ok = await saveLspConfig({ removeLspIds: [id] });
    if (ok) {
      setStatus('ok', `Removed ${id}`);
      await renderLspSection();
      return;
    }
    setStatus('err', 'Remove failed — use npm start');
  };

  const catalog = appendSettingsGroup(
    mount,
    'Servers',
    'Shipped analyzers and bundle-backed servers; custom entries are merged from your home config.',
  );

  const list = el('div', 'settings-lsp-list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Configured language servers');

  if (servers.length === 0) {
    list.append(el('p', 'settings-field-hint', 'No language servers in defaults or lsp.json.'));
  } else {
    for (const server of servers) {
      list.append(
        createLspSettingsRow(server, (id, enabled) => {
          void setServerDisabled(id, enabled);
        }, removeCustomServer),
      );
    }
  }

  catalog.append(list);

  const customGroup = appendSettingsGroup(
    mount,
    'Custom server',
    'Register a stdio language server and the file extensions it owns.',
  );
  appendCustomServerPanel(customGroup, refresh);
}
