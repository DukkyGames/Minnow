/**
 * Shared tool permission list UI for drawer, settings page, and composer popover.
 */

import {
  isToolPermissionMode,
  saveBraveApiKeyFromDrawer,
  setToolPermission,
  setToolsEnabled,
  getToolIdsForCategory,
} from '../tools/config';
import {
  BUILT_IN_TOOLS,
  type ToolCategory,
} from '../tools/definitions';

/** Category order and labels for tool permission lists. */
const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  'web',
  'utility',
  'browser',
  'agents',
  'lsp',
  'files',
  'git',
  'code',
];

const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  web: 'Web',
  utility: 'Utility',
  browser: 'Browser (CDP)',
  agents: 'Sub-agents',
  files: 'Files',
  git: 'Git',
  code: 'Code',
  lsp: 'LSP',
};

export type ToolsListVariant = 'default' | 'composer';

export type FillToolsSectionOptions = {
  variant?: ToolsListVariant;
};

let toolHandlersRegistered = false;

/** Build a per-category or global "select all" control. */
function createToolSelectAllControl(
  scope: 'global' | ToolCategory,
  labelText: string,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'tool-select-all';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  if (scope === 'global') {
    checkbox.setAttribute('data-select-all', 'global');
    checkbox.setAttribute('aria-label', 'Enable all tools');
  } else {
    checkbox.setAttribute('data-select-all-category', scope);
    checkbox.setAttribute(
      'aria-label',
      `Enable all ${TOOL_CATEGORY_LABELS[scope]} tools`,
    );
  }

  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(checkbox, text);
  return label;
}

/** Handle permission select and bulk checkbox changes on a tools list. */
function handleToolsListChange(event: Event, list: HTMLElement): void {
  const target = event.target;
  if (
    target instanceof HTMLSelectElement &&
    target.classList.contains('tool-permission-select')
  ) {
    const row = target.closest<HTMLElement>('[data-tool-id]');
    const id = row?.getAttribute('data-tool-id');
    if (!id) return;
    const mode = target.value;
    if (!isToolPermissionMode(mode)) return;
    setToolPermission(id, mode, list);
    return;
  }

  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
    return;
  }

  if (target.getAttribute('data-select-all') === 'global') {
    const ids = BUILT_IN_TOOLS.map((tool) => tool.id);
    setToolsEnabled(ids, target.checked, list);
    return;
  }

  const category = target.getAttribute('data-select-all-category');
  if (category) {
    const ids = getToolIdsForCategory(category as ToolCategory);
    setToolsEnabled(ids, target.checked, list);
    return;
  }
}

/** Wire change delegation once per tools list element. */
export function bindToolsListChange(list: HTMLElement): void {
  if (list.dataset.toolsChangeBound === 'true') return;
  list.dataset.toolsChangeBound = 'true';
  list.addEventListener('change', (event) => handleToolsListChange(event, list));
}

/** Populate a tool list container with grouped permission rows. */
export function fillToolsSection(
  containerId = 'toolsList',
  options: FillToolsSectionOptions = {},
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const variant = options.variant ?? 'default';
  container.replaceChildren();
  container.classList.toggle('tools-list--composer', variant === 'composer');

  const toolbar = document.createElement('div');
  toolbar.className = 'tool-list-toolbar';
  toolbar.appendChild(createToolSelectAllControl('global', 'Enable all tools'));
  container.appendChild(toolbar);

  for (const category of TOOL_CATEGORY_ORDER) {
    const tools = BUILT_IN_TOOLS.filter((tool) => tool.category === category);
    if (tools.length === 0) continue;

    const group = document.createElement('section');
    group.className = 'tool-group';
    group.setAttribute('data-tool-category', category);

    const head = document.createElement('div');
    head.className = 'tool-group-head';

    const header = document.createElement('h3');
    header.className = 'tool-group-header';
    header.textContent = TOOL_CATEGORY_LABELS[category];

    head.append(header, createToolSelectAllControl(category, 'All'));
    group.appendChild(head);

    if (category === 'browser') {
      const hint = document.createElement('p');
      hint.className = 'tool-group-hint';
      hint.textContent =
        'Requires Chrome with --remote-debugging-port and npm start.';
      group.appendChild(hint);
    }

    for (const tool of tools) {
      const row = document.createElement('div');
      row.className = 'tool-row';
      row.setAttribute('data-tool-id', tool.id);
      if (tool.serverRequired) {
        row.setAttribute('data-server-required', '');
      }

      const controlWrap = document.createElement('div');
      controlWrap.className = 'tool-permission-wrap';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tool-label';
      nameSpan.textContent = tool.label;

      const select = document.createElement('select');
      select.className = 'tool-permission-select';
      select.setAttribute('aria-label', `${tool.label} permission`);
      if (variant !== 'composer') {
        select.setAttribute('aria-describedby', `tool-desc-${tool.id}`);
      }
      for (const optDef of [
        { value: 'off', label: 'Disabled' },
        { value: 'ask', label: 'Requires permission' },
        { value: 'full', label: 'Full permission' },
      ] as const) {
        const opt = document.createElement('option');
        opt.value = optDef.value;
        opt.textContent = optDef.label;
        select.appendChild(opt);
      }

      controlWrap.append(nameSpan, select);

      row.appendChild(controlWrap);

      if (variant !== 'composer') {
        const desc = document.createElement('p');
        desc.className = 'tool-desc';
        desc.id = `tool-desc-${tool.id}`;
        desc.textContent = tool.description;
        row.appendChild(desc);
      }

      group.appendChild(row);
    }

    container.appendChild(group);
  }

  bindToolsListChange(container);
}

/** Bind tool lists and Brave API key field to config handlers (once per app boot). */
export function registerToolHandlers(): void {
  if (toolHandlersRegistered) return;
  toolHandlersRegistered = true;

  const drawerList = document.getElementById('toolsList');
  if (drawerList) {
    bindToolsListChange(drawerList);
  }

  const settingsList = document.getElementById('settingsToolsList');
  if (settingsList) {
    bindToolsListChange(settingsList);
  }

  const composerList = document.getElementById('composerToolsList');
  if (composerList) {
    bindToolsListChange(composerList);
  }

  const braveInput = document.getElementById('braveApiKey');
  if (braveInput) {
    braveInput.addEventListener('input', saveBraveApiKeyFromDrawer);
    braveInput.addEventListener('change', saveBraveApiKeyFromDrawer);
  }
}
