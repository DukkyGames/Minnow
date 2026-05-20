/**
 * LSP settings section: list built-in/custom servers, toggles, add custom server.
 */

import {
  fetchLspConfig,
  saveLspConfig,
  type LspServerStatus,
} from '../lsp/config-client';
import { isLocalServerAvailable } from '../tools/config';
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

function sortServers(servers: LspServerStatus[]): LspServerStatus[] {
  return [...servers].sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
}

function parseCommaList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function createLspServerRow(
  server: LspServerStatus,
  onToggle: (id: string, enabled: boolean) => void,
  onDelete: (id: string) => void,
): HTMLElement {
  const row = el('div', 'settings-lsp-row');
  row.setAttribute('role', 'listitem');

  const head = el('div', 'settings-lsp-row-head');

  const labelWrap = el('label', 'settings-toggle-row');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !server.disabled;
  checkbox.setAttribute(
    'aria-label',
    `${server.disabled ? 'Enable' : 'Disable'} ${server.label}`,
  );
  checkbox.addEventListener('change', () => {
    onToggle(server.id, checkbox.checked);
  });
  labelWrap.append(checkbox, el('span', '', server.label));
  head.append(labelWrap);

  if (server.builtin) {
    const badge = el('span', 'settings-lsp-badge settings-lsp-badge--builtin', 'Built-in');
    head.append(badge);
  } else {
    const removeBtn = el('button', 'settings-lsp-remove', 'Remove');
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', () => onDelete(server.id));
    head.append(removeBtn);
  }

  row.append(head);

  const meta = el('div', 'settings-lsp-meta');
  meta.append(el('span', '', server.id));

  if (server.extensions.length > 0) {
    const ext = el('span', 'settings-lsp-extensions', server.extensions.join(' '));
    meta.append(ext);
  }

  const statusBadge = el(
    'span',
    `settings-lsp-badge ${server.running ? 'settings-lsp-badge--running' : 'settings-lsp-badge--idle'}`,
    server.running ? 'Running' : 'Idle',
  );
  meta.append(statusBadge);

  if (!server.hasCommand && !server.disabled) {
    meta.append(
      el(
        'span',
        'settings-lsp-warn',
        'No command configured — set command in ~/.minnow/lsp.json',
      ),
    );
  }

  row.append(meta);
  return row;
}

function buildCustomServerForm(onAdded: () => void): HTMLElement {
  const form = el('form', 'settings-lsp-custom-form');
  form.setAttribute('aria-label', 'Add custom language server');

  const idField = el('div', 'field');
  idField.append(el('label', '', 'Server id'));
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.name = 'id';
  idInput.required = true;
  idInput.placeholder = 'my-lsp';
  idInput.pattern = '[a-z0-9][a-z0-9._-]*';
  idInput.title = 'Lowercase letters, numbers, dots, hyphens, underscores';
  idField.append(idInput);
  form.append(idField);

  const labelField = el('div', 'field');
  labelField.append(el('label', '', 'Display label'));
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.name = 'label';
  labelInput.placeholder = 'My Language Server';
  labelField.append(labelInput);
  form.append(labelField);

  const cmdField = el('div', 'field');
  cmdField.append(el('label', '', 'Command (one argument per token, space-separated)'));
  const cmdInput = document.createElement('input');
  cmdInput.type = 'text';
  cmdInput.name = 'command';
  cmdInput.required = true;
  cmdInput.placeholder = 'my-lsp-server --stdio';
  cmdField.append(cmdInput);
  form.append(cmdField);

  const extField = el('div', 'field');
  extField.append(el('label', '', 'File extensions (comma-separated)'));
  const extInput = document.createElement('input');
  extInput.type = 'text';
  extInput.name = 'extensions';
  extInput.required = true;
  extInput.placeholder = '.foo, .bar';
  extField.append(extInput);
  form.append(extField);

  const actions = el('div', 'settings-lsp-custom-actions');
  const submit = el('button', 'settings-action-btn', 'Add server');
  submit.type = 'submit';
  actions.append(submit);
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

/** Render language server list, toggles, and custom-server form. */
export async function renderLspSection(): Promise<void> {
  const list = document.getElementById('settingsLspServerList');
  const offline = document.getElementById('settingsLspOffline');
  const addPanel = document.getElementById('settingsLspAddPanel');
  const masterCb = document.getElementById(
    'settingsLspMasterEnabled',
  ) as HTMLInputElement | null;
  const customMount = document.getElementById('settingsLspCustomForm');
  if (!list) return;

  list.replaceChildren();

  const online = isLocalServerAvailable();
  offline?.classList.toggle('hidden', online);
  addPanel?.classList.toggle('hidden', !online);

  if (!online) {
    customMount?.replaceChildren();
    return;
  }

  const config = await fetchLspConfig();
  if (!config) {
    offline?.classList.remove('hidden');
    addPanel?.classList.add('hidden');
    return;
  }

  if (masterCb) {
    masterCb.checked = config.enabled !== false;
    masterCb.onchange = () => {
      void saveLspConfig({ enabled: masterCb.checked }).then((ok) => {
        setStatus(
          ok ? 'ok' : 'err',
          ok ? 'LSP master switch saved' : 'Save failed — use npm start',
        );
      });
    };
  }

  const refresh = () => {
    void renderLspSection();
  };

  if (customMount && customMount.childElementCount === 0) {
    customMount.append(buildCustomServerForm(refresh));
  }

  const servers = sortServers(visibleServers(config.servers));
  if (servers.length === 0) {
    list.appendChild(el('p', 'settings-field-hint', 'No language servers configured.'));
    return;
  }

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
    const ok = await saveLspConfig({ removeLspIds: [id] });
    if (ok) {
      setStatus('ok', `Removed ${id}`);
      await renderLspSection();
      return;
    }
    setStatus('err', 'Remove failed — use npm start');
  };

  for (const server of servers) {
    list.appendChild(
      createLspServerRow(server, (id, enabled) => {
        void setServerDisabled(id, enabled);
      }, removeCustomServer),
    );
  }
}
