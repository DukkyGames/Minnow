/**

 * Language servers settings: categorized rows with install + enable toggles.

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

  type LspBundlesResponse,

  type LspServerStatus,

} from '../lsp/config-client';

import { detectLocalServer } from '../tools/client';

import { isLocalServerAvailable } from '../tools/config';

import { appendSettingsCrosslinks, appendSettingsGroup } from './settings-layout';

import { createSettingsSwitch } from './settings-switch';

import { appendSettingsOfflineHint } from './settings-controls';

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



/** Hide test-only fake server from the settings list. */

function visibleServers(servers: LspServerStatus[]): LspServerStatus[] {

  return servers.filter((s) => s.id !== 'fake');

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



function parseCommaList(raw: string): string[] {

  return raw

    .split(/[,\n]+/)

    .map((s) => s.trim())

    .filter(Boolean);

}



/** Compact instrumentation row: master switch plus live counts. */

function appendLspToolbar(

  mount: HTMLElement,

  opts: {

    masterOn: boolean;

    configured: number;

    enabled: number;

    running: number;

    onMasterChange: (checked: boolean) => void;

  },

): void {

  const bar = el('div', 'settings-lsp-toolbar');

  bar.setAttribute('role', 'group');

  bar.setAttribute('aria-label', 'Language server status');



  const control = el('div', 'settings-lsp-toolbar__control');

  const { root: switchRoot } = createSettingsSwitch({

    checked: opts.masterOn,

    ariaLabel: 'Enable all language servers',

    onChange: opts.onMasterChange,

  });

  control.append(

    switchRoot,

    el('span', 'settings-lsp-toolbar__label', 'Enable language servers'),

  );

  bar.append(control);



  const stats = el('div', 'settings-lsp-stats');

  const chips: Array<{ label: string; value: string; tone?: 'ok' | 'muted' }> = [

    { label: 'Configured', value: String(opts.configured) },

    {

      label: 'Enabled',

      value: opts.masterOn ? String(opts.enabled) : '0',

      tone: opts.masterOn && opts.enabled > 0 ? 'ok' : 'muted',

    },

    {

      label: 'Running',

      value: opts.masterOn ? String(opts.running) : '—',

      tone: opts.masterOn && opts.running > 0 ? 'ok' : 'muted',

    },

  ];

  for (const chip of chips) {

    const item = el('div', 'settings-lsp-stat');

    item.append(el('span', 'settings-lsp-stat__label', chip.label));

    const value = el(

      'span',

      `settings-lsp-stat__value${chip.tone === 'ok' ? ' settings-lsp-stat__value--ok' : ''}`,

      chip.value,

    );

    item.append(value);

    stats.append(item);

  }

  bar.append(stats);



  const storage = el('p', 'settings-lsp-storage');

  storage.append(document.createTextNode('Overrides: '));

  const pathCode = document.createElement('code');

  pathCode.textContent = '~/.minnow/lsp.json';

  storage.append(pathCode);

  mount.append(bar, storage);

}



/** Label + switch for Installed / Enabled columns on each server row. */

function createLspMiniToggle(

  label: string,

  options: {

    checked: boolean;

    disabled?: boolean;

    ariaLabel: string;

    onChange?: (checked: boolean) => void;

  },

): { cell: HTMLDivElement; input: HTMLInputElement } {

  const cell = el('div', 'settings-lsp-mini-toggle');

  const { root, input } = createSettingsSwitch({

    checked: options.checked,

    disabled: options.disabled,

    ariaLabel: options.ariaLabel,

    onChange: options.onChange,

  });

  cell.append(el('span', 'settings-lsp-mini-toggle__label', label), root);

  return { cell, input };

}



/** Wire install/uninstall for a bundle-backed server row. */

function bindBundleInstallToggle(

  input: HTMLInputElement,

  bundle: LspBundleStatus,

  progress: HTMLElement,

  progressFill: HTMLElement,

  progressText: HTMLElement,

  onChanged: () => void,

): void {

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



  const setInstallChecked = (checked: boolean, disabled?: boolean) => {

    input.checked = checked;

    if (disabled !== undefined) input.disabled = disabled;

  };



  const handleInstallJob = (

    job: LspBundleJob | null | undefined,

    alreadyInstalled = false,

  ): boolean => {

    if (!job) return false;

    if (job.phase === 'error') {

      setStatus('err', job.error ?? job.message ?? 'Install failed');

      stopPoll();

      hideProgress();

      setInstallChecked(bundle.installed, bundle.prebundled === true && bundle.installed);

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



  input.addEventListener('change', () => {

    const wantInstalled = input.checked;



    if (!wantInstalled && bundle.installed && !bundle.prebundled) {

      if (!confirm(`Remove ${bundle.label} from ~/.minnow/lsp-servers?`)) {

        input.checked = true;

        return;

      }

      input.disabled = true;

      void uninstallLspBundle(bundle.id).then((ok) => {

        setStatus(ok ? 'ok' : 'err', ok ? `Removed ${bundle.label}` : 'Uninstall failed');

        stopPoll();

        hideProgress();

        if (!ok) input.checked = true;

        input.disabled = bundle.prebundled === true;

        onChanged();

      });

      return;

    }



    if (wantInstalled && !bundle.installed) {

      input.disabled = true;

      showProgress(0, 'Starting…');



      const pollProgress = (alreadyInstalled: boolean) => {

        void fetchLspBundleProgress(bundle.id).then((payload) => {

          handleInstallJob(payload?.job, alreadyInstalled);

        });

      };



      void installLspBundle(bundle.id).then(async (result) => {

        if (!result.ok) {

          setStatus('err', result.error ?? 'Install failed');

          hideProgress();

          setInstallChecked(false);

          onChanged();

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

      });

      return;

    }



    input.checked = bundle.installed;

  });

}



function createLspSettingsRow(

  server: LspServerStatus,

  bundle: LspBundleStatus | null,

  onToggle: (id: string, enabled: boolean) => void,

  onDelete: (id: string) => void,

  onChanged: () => void,

): HTMLElement {

  const row = el('article', 'settings-lsp-row');

  row.setAttribute('role', 'listitem');

  row.dataset.serverId = server.id;

  if (bundle) row.dataset.bundleId = bundle.id;



  const head = el('div', 'settings-lsp-row-head');

  const toggles = el('div', 'settings-lsp-row-toggles');



  let enableInput: HTMLInputElement | null = null;

  let bundleProgress: HTMLElement | null = null;



  if (bundle) {

    const installLocked = bundle.prebundled === true && bundle.installed;

    const { cell: installCell, input: installInput } = createLspMiniToggle('Installed', {

      checked: bundle.installed,

      disabled: installLocked,

      ariaLabel: installLocked

        ? `${bundle.label} ships with Minnow`

        : bundle.installed

          ? `Uninstall ${bundle.label}`

          : `Install ${bundle.label}`,

    });



    bundleProgress = el('div', 'settings-lsp-bundle-progress');

    bundleProgress.hidden = true;

    const progressBar = el('div', 'settings-lsp-bundle-progress-bar');

    const progressFill = el('div', 'settings-lsp-bundle-progress-fill');

    progressBar.append(progressFill);

    const progressText = el('span', 'settings-lsp-bundle-progress-text');

    bundleProgress.append(progressBar, progressText);



    bindBundleInstallToggle(

      installInput,

      bundle,

      bundleProgress,

      progressFill,

      progressText,

      onChanged,

    );



    const canEnable = bundle.installed;

    const enableToggle = createLspMiniToggle('Enabled', {

      checked: canEnable && !server.disabled,

      disabled: !canEnable,

      ariaLabel: `${server.disabled ? 'Enable' : 'Disable'} ${server.label}`,

      onChange: (enabled) => onToggle(server.id, enabled),

    });

    enableInput = enableToggle.input;

    toggles.append(installCell, enableToggle.cell);

  } else {

    const enableToggle = createLspMiniToggle('Enabled', {

      checked: !server.disabled,

      ariaLabel: `${server.disabled ? 'Enable' : 'Disable'} ${server.label}`,

      onChange: (enabled) => onToggle(server.id, enabled),

    });

    enableInput = enableToggle.input;

    toggles.append(enableToggle.cell);

  }



  head.append(toggles);



  const identity = el('div', 'settings-lsp-row-identity');

  identity.append(el('span', 'settings-lsp-name', server.label));

  if (bundle?.description) {

    const desc = el('span', 'settings-lsp-row-desc');

    desc.textContent = bundle.description;

    desc.title = bundle.description;

    identity.append(desc);

  }

  head.append(identity);



  const headMeta = el('div', 'settings-lsp-row-head-meta');

  if (bundle?.installed) {

    const status = el(

      'span',

      `settings-lsp-pill ${server.running ? 'settings-lsp-pill--running' : 'settings-lsp-pill--idle'}`,

      server.running ? 'Running' : 'Idle',

    );

    status.setAttribute(

      'aria-label',

      server.running ? 'Language server process running' : 'Language server idle',

    );

    headMeta.append(status);

  } else if (bundle && !bundle.installed) {

    headMeta.append(el('span', 'settings-lsp-pill settings-lsp-pill--off', 'Not installed'));

  } else {

    const status = el(

      'span',

      `settings-lsp-pill ${server.running ? 'settings-lsp-pill--running' : 'settings-lsp-pill--idle'}`,

      server.running ? 'Running' : 'Idle',

    );

    headMeta.append(status);

  }



  if (bundle) {

    const sizeLabel = formatBundleSize(bundle.sizeBytes, bundle.sizeEstimateMb);

    if (bundle.installed && bundle.version) {

      headMeta.append(el('span', 'settings-lsp-bundle-tag', `v${bundle.version}`));

    } else if (sizeLabel) {

      headMeta.append(el('span', 'settings-lsp-bundle-tag', sizeLabel));

    }

    if (bundle.prebundled) {

      headMeta.append(el('span', 'settings-lsp-badge settings-lsp-badge--builtin', 'Bundled'));

    } else if (bundle.kind === 'binary') {

      headMeta.append(el('span', 'settings-lsp-bundle-tag settings-lsp-bundle-tag--muted', 'Binary'));

    }

  } else if (server.builtin) {

    headMeta.append(el('span', 'settings-lsp-badge settings-lsp-badge--builtin', 'Built-in'));

  } else {

    const removeBtn = el('button', 'settings-inline-btn settings-lsp-remove', 'Remove');

    removeBtn.type = 'button';

    removeBtn.setAttribute('aria-label', `Remove ${server.label}`);

    removeBtn.addEventListener('click', () => onDelete(server.id));

    headMeta.append(removeBtn);

  }



  head.append(headMeta);

  row.append(head);



  const detailBits: string[] = [];

  if (server.extensions.length > 0) {

    detailBits.push(server.extensions.join(' '));

  }

  const reqHint = formatRequirementsHint(server.requirements);

  if (server.disabledReason) {

    detailBits.push(server.disabledReason);

  } else if (reqHint) {

    detailBits.push(reqHint);

  }

  if (detailBits.length > 0) {

    const detail = el('p', 'settings-lsp-row-detail');

    detail.textContent = detailBits.join(' · ');

    detail.title = detailBits.join(' · ');

    row.append(detail);

  }



  if (enableInput && bundle && !bundle.installed) {

    enableInput.disabled = true;

    enableInput.checked = false;

  }



  if (bundleProgress) {

    row.append(bundleProgress);

  }



  return row;

}



function appendServerCategory(

  mount: HTMLElement,

  title: string,

  rows: HTMLElement[],

): void {

  if (rows.length === 0) return;

  const section = el('section', 'settings-lsp-category');

  section.append(el('h4', 'settings-lsp-category-title', title));

  const list = el('div', 'settings-lsp-list');

  list.setAttribute('role', 'list');

  list.setAttribute('aria-label', `${title} language servers`);

  for (const row of rows) {

    list.append(row);

  }

  section.append(list);

  mount.append(section);

}



/** Group servers by bundle catalog categories; extras go in Core / Custom. */

function appendCategorizedServerCatalog(

  mount: HTMLElement,

  servers: LspServerStatus[],

  categories: LspBundlesResponse['categories'] | undefined,

  handlers: {

    onToggle: (id: string, enabled: boolean) => void;

    onDelete: (id: string) => void;

    onChanged: () => void;

  },

): void {

  const serverById = new Map(servers.map((s) => [s.id, s]));

  const consumed = new Set<string>();



  if (categories?.length) {

    for (const category of categories) {

      const rows: HTMLElement[] = [];

      for (const bundle of category.bundles ?? []) {

        const lspId = bundle.lspIds?.[0];

        if (!lspId) continue;

        const server = serverById.get(lspId);

        if (!server) continue;

        consumed.add(lspId);

        rows.push(

          createLspSettingsRow(server, bundle, handlers.onToggle, handlers.onDelete, handlers.onChanged),

        );

      }

      appendServerCategory(mount, category.label, rows);

    }

  }



  const remaining = servers.filter((s) => !consumed.has(s.id));

  const core = remaining.filter((s) => s.builtin);

  const custom = remaining.filter((s) => !s.builtin);



  const coreRows = core.map((server) =>

    createLspSettingsRow(server, null, handlers.onToggle, handlers.onDelete, handlers.onChanged),

  );

  appendServerCategory(mount, 'Core', coreRows);



  const customRows = custom.map((server) =>

    createLspSettingsRow(server, null, handlers.onToggle, handlers.onDelete, handlers.onChanged),

  );

  appendServerCategory(mount, 'Custom', customRows);



  if (servers.length === 0) {

    mount.append(el('p', 'settings-field-hint', 'No language servers in defaults or lsp.json.'));

  }

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



/** Render the full Language servers settings section into #settingsLspBody. */

export async function renderLspSection(): Promise<void> {

  const mount = document.getElementById('settingsLspBody');

  if (!mount) return;

  mount.replaceChildren();



  await detectLocalServer();

  const online = isLocalServerAvailable();

  if (!online) {

    appendSettingsOfflineHint(

      mount,

      'Start with <code>npm start</code> to load server status, toggle analyzers, and save <code>~/.minnow/lsp.json</code>.',

    );

    return;

  }



  const [config, bundleData] = await Promise.all([fetchLspConfig(), fetchLspBundles()]);



  if (!config) {

    appendSettingsOfflineHint(

      mount,

      'Could not load language server config. Confirm <code>npm start</code> is running.',

    );

    return;

  }



  const servers = visibleServers(config.servers);

  const enabledCount = servers.filter((s) => !s.disabled).length;

  const runningCount = servers.filter((s) => s.running).length;

  const masterOn = config.enabled !== false;



  const statusGroup = appendSettingsGroup(mount, 'Status', undefined, 'integrations.lsp');

  appendLspToolbar(statusGroup, {

    masterOn,

    configured: servers.length,

    enabled: enabledCount,

    running: runningCount,

    onMasterChange: (checked) => {

      void saveLspConfig({ enabled: checked }).then((ok) => {

        setStatus(

          ok ? 'ok' : 'err',

          ok ? 'Language servers updated' : 'Save failed — use npm start',

        );

        if (ok) void renderLspSection();

      });

    },

  });



  const refresh = () => {

    void renderLspSection();

  };



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

    'Language servers',

    'Installed toggles download optional binaries to ~/.minnow/lsp-servers. Enabled toggles start analyzers when npm start is running.',

    'integrations.lsp',

  );



  appendCategorizedServerCatalog(catalog, servers, bundleData?.categories, {

    onToggle: (id, enabled) => {

      void setServerDisabled(id, enabled);

    },

    onDelete: (id) => {

      void removeCustomServer(id);

    },

    onChanged: refresh,

  });



  const customGroup = appendSettingsGroup(

    mount,

    'Custom server',

    'Register a stdio language server and the file extensions it owns.',

    'integrations.lsp.custom',

  );

  appendCustomServerPanel(customGroup, refresh);



  appendSettingsCrosslinks(mount, [

    { label: 'Editor', sectionId: 'editor' },

    { label: 'Tools', sectionId: 'tools' },

    { label: 'MCP servers', sectionId: 'mcp' },

  ]);

}


