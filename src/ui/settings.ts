import { PRESET_STORAGE_KEY, SYSTEM_PROMPT_PRESETS } from '../constants';
import { getSystemPrompt, putSystemPrompt } from '../config/api-client';
import { defaultSystemPromptSettings } from '../config/defaults';
import { fetchModels } from '../api/models';
import { isServerStorageMode } from '../config/storage-mode';
import {
  getActiveProvider,
  invalidateProviderCache,
  isProvidersApiAvailable,
  listProviders,
  setActiveProvider,
} from '../providers/store';
import { setActiveProviderBaseUrl, setStatus } from './status';
import { onToolToggle, saveBraveApiKeyFromDrawer } from '../tools/config';
import type { SystemPromptSettings } from '../types';
import {
  BUILT_IN_TOOLS,
  type ToolCategory,
} from '../tools/definitions';
import {
  activeSystemPromptPresetId,
  setActiveSystemPromptPresetId,
  setSuppressSystemPromptSelectChange,
  suppressSystemPromptSelectChange,
} from '../app-state';

const DRAWER_FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Category order and labels for the Tools drawer section. */
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

let drawerReturnFocus: HTMLElement | null = null;
let toolHandlersRegistered = false;
let providerHandlersRegistered = false;

function systemPromptPresetById(id: string) {
  return SYSTEM_PROMPT_PRESETS.find((p) => p.id === id);
}

function getActivePresetText(presetId: string): string {
  if (!presetId) return '';
  const p = systemPromptPresetById(presetId);
  return p ? p.text : '';
}

export function fillSystemPromptPresetSelect(): void {
  const sel = document.getElementById('systemPromptPreset') as HTMLSelectElement;
  sel.replaceChildren();
  const optCustom = document.createElement('option');
  optCustom.value = '';
  optCustom.textContent = 'Custom prompt';
  sel.appendChild(optCustom);
  for (const p of SYSTEM_PROMPT_PRESETS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
}

function currentSystemPromptSettings(): SystemPromptSettings {
  return {
    presetId: activeSystemPromptPresetId,
    text: (document.getElementById('systemPrompt') as HTMLTextAreaElement).value,
  };
}

function applySystemPromptSettingsToDom(data: SystemPromptSettings): void {
  const text = typeof data.text === 'string' ? data.text : '';
  const presetId = typeof data.presetId === 'string' ? data.presetId : '';
  const ta = document.getElementById('systemPrompt') as HTMLTextAreaElement;
  const sel = document.getElementById('systemPromptPreset') as HTMLSelectElement;
  ta.value = text;
  const template = getActivePresetText(presetId).trim();
  if (presetId && template !== '' && text.trim() === template) {
    setActiveSystemPromptPresetId(presetId);
    sel.value = presetId;
  } else {
    setActiveSystemPromptPresetId('');
    sel.value = '';
  }
}

export function saveSystemPromptSettings(): void {
  const payload = currentSystemPromptSettings();

  if (isServerStorageMode()) {
    void putSystemPrompt(payload).catch(() => {
      setStatus('err', 'Could not save system prompt to ~/.speedchat');
    });
    return;
  }

  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export async function loadSystemPromptSettings(): Promise<void> {
  if (isServerStorageMode()) {
    try {
      const data = await getSystemPrompt();
      applySystemPromptSettingsToDom(data);
      return;
    } catch {
      setStatus('err', 'Could not load system prompt from ~/.speedchat');
    }
  }

  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      applySystemPromptSettingsToDom(defaultSystemPromptSettings());
      return;
    }
    const data = JSON.parse(raw) as SystemPromptSettings;
    applySystemPromptSettingsToDom(data);
  } catch {
    applySystemPromptSettingsToDom(defaultSystemPromptSettings());
  }
}

export function applySystemPromptPreset(id: string): void {
  setActiveSystemPromptPresetId(id || '');
  const ta = document.getElementById('systemPrompt') as HTMLTextAreaElement;
  const sel = document.getElementById('systemPromptPreset') as HTMLSelectElement;
  if (activeSystemPromptPresetId) {
    ta.value = getActivePresetText(activeSystemPromptPresetId);
  }
  sel.value = activeSystemPromptPresetId;
}

export function onSystemPromptPresetChange(): void {
  if (suppressSystemPromptSelectChange) return;
  const sel = document.getElementById('systemPromptPreset') as HTMLSelectElement;
  const targetId = sel.value;
  const currentTrim = (document.getElementById('systemPrompt') as HTMLTextAreaElement).value.trim();
  const committedTrim = getActivePresetText(activeSystemPromptPresetId).trim();
  const dirty = currentTrim !== committedTrim;

  if (targetId === '') {
    setActiveSystemPromptPresetId('');
    saveSystemPromptSettings();
    return;
  }
  if (
    dirty &&
    !confirm('Replace your current system prompt with this preset? Unsaved edits will be lost.')
  ) {
    setSuppressSystemPromptSelectChange(true);
    sel.value = activeSystemPromptPresetId;
    setSuppressSystemPromptSelectChange(false);
    return;
  }
  applySystemPromptPreset(targetId);
  saveSystemPromptSettings();
}

/** Build tool toggle rows from BUILT_IN_TOOLS (single source of truth). */
/** Show banner when provider API is unavailable (Vite-only). */
export function refreshProvidersBanner(): void {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('providersServerBanner');
  if (!banner) return;
  const hide = isServerStorageMode() && isProvidersApiAvailable();
  banner.classList.toggle('hidden', hide);
}

/** Populate provider select from /api/providers. */
export async function loadProviderSelect(): Promise<void> {
  const sel = document.getElementById('providerSelect') as HTMLSelectElement | null;
  if (!sel) return;

  const { providers, activeProviderId } = await listProviders();
  const enabled = providers.filter((p) => p.enabled !== false);
  sel.replaceChildren();

  for (const p of enabled) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }

  if (enabled.some((p) => p.id === activeProviderId)) {
    sel.value = activeProviderId;
  } else if (enabled.length > 0) {
    sel.value = enabled[0].id;
  }

  const active = await getActiveProvider();
  setActiveProviderBaseUrl(active.baseUrl);

  const urlInput = document.getElementById('serverUrl') as HTMLInputElement | null;
  if (urlInput) {
    const serverMode = isServerStorageMode() && isProvidersApiAvailable();
    urlInput.readOnly = serverMode;
    if (!serverMode) {
      urlInput.removeAttribute('readonly');
    }
  }

  refreshProvidersBanner();
}

/** Wire provider select change → set active + refresh models. */
export function registerProviderHandlers(): void {
  if (providerHandlersRegistered) return;
  providerHandlersRegistered = true;

  const sel = document.getElementById('providerSelect');
  if (!sel) return;

  sel.addEventListener('change', () => {
    void onProviderSelectChange();
  });
}

async function onProviderSelectChange(): Promise<void> {
  const sel = document.getElementById('providerSelect') as HTMLSelectElement;
  const id = sel.value;
  if (!id) return;

  try {
    await setActiveProvider(id);
    invalidateProviderCache();
    const active = await getActiveProvider(id);
    setActiveProviderBaseUrl(active.baseUrl);
    await fetchModels();
    setStatus('ok', `Active provider: ${active.label}`);
  } catch {
    setStatus('err', 'Could not switch provider');
  }
}

export function fillToolsSection(): void {
  const container = document.getElementById('toolsList');
  if (!container) return;

  container.replaceChildren();

  for (const category of TOOL_CATEGORY_ORDER) {
    const tools = BUILT_IN_TOOLS.filter((tool) => tool.category === category);
    if (tools.length === 0) continue;

    const header = document.createElement('h3');
    header.className = 'tool-group-header';
    header.textContent = TOOL_CATEGORY_LABELS[category];
    container.appendChild(header);

    if (category === 'browser') {
      const hint = document.createElement('p');
      hint.className = 'tool-group-hint';
      hint.textContent =
        'Requires Chrome with --remote-debugging-port and npm start.';
      container.appendChild(hint);
    }

    for (const tool of tools) {
      const row = document.createElement('div');
      row.className = 'tool-row';
      row.setAttribute('data-tool-id', tool.id);
      if (tool.serverRequired) {
        row.setAttribute('data-server-required', '');
      }

      const label = document.createElement('label');
      label.className = 'tool-toggle-wrap';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tool-toggle';
      checkbox.id = `tool-${tool.id}`;
      checkbox.setAttribute('aria-describedby', `tool-desc-${tool.id}`);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tool-label';
      nameSpan.textContent = tool.label;

      label.appendChild(checkbox);
      label.appendChild(nameSpan);

      const desc = document.createElement('p');
      desc.className = 'tool-desc';
      desc.id = `tool-desc-${tool.id}`;
      desc.textContent = tool.description;

      row.appendChild(label);
      row.appendChild(desc);
      container.appendChild(row);
    }
  }
}

/** Bind tool checkboxes and Brave API key field to config handlers. */
export function registerToolHandlers(): void {
  if (toolHandlersRegistered) return;
  toolHandlersRegistered = true;

  const list = document.getElementById('toolsList');
  if (list) {
    list.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
        return;
      }
      const row = target.closest<HTMLElement>('[data-tool-id]');
      const id = row?.getAttribute('data-tool-id');
      if (!id) return;
      onToolToggle(id);
    });
  }

  const braveInput = document.getElementById('braveApiKey');
  if (braveInput) {
    braveInput.addEventListener('input', saveBraveApiKeyFromDrawer);
    braveInput.addEventListener('change', saveBraveApiKeyFromDrawer);
  }
}

export function onSystemPromptInput(): void {
  const ta = document.getElementById('systemPrompt') as HTMLTextAreaElement;
  const sel = document.getElementById('systemPromptPreset') as HTMLSelectElement;
  const currentTrim = ta.value.trim();
  const templateTrim = getActivePresetText(activeSystemPromptPresetId).trim();
  if (currentTrim !== templateTrim) {
    if (activeSystemPromptPresetId !== '' || sel.value !== '') {
      setActiveSystemPromptPresetId('');
      setSuppressSystemPromptSelectChange(true);
      sel.value = '';
      setSuppressSystemPromptSelectChange(false);
    }
  }
  saveSystemPromptSettings();
}

export function toggleDrawer(): void {
  const drawer = document.getElementById('drawer')!;
  if (drawer.classList.contains('open')) {
    closeDrawer();
    return;
  }
  drawerReturnFocus = document.activeElement as HTMLElement | null;
  drawer.classList.add('open');
  document.getElementById('drawerOverlay')!.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.removeAttribute('inert');
  const overlay = document.getElementById('drawerOverlay')!;
  overlay.setAttribute('aria-hidden', 'false');
  (overlay as HTMLButtonElement).tabIndex = 0;
  document.getElementById('btnSettings')!.setAttribute('aria-expanded', 'true');
  const first = drawer.querySelector(DRAWER_FOCUSABLE) as HTMLElement | null;
  if (first) first.focus();
}

export function closeDrawer(): void {
  const drawer = document.getElementById('drawer')!;
  drawer.classList.remove('open');
  document.getElementById('drawerOverlay')!.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('inert', '');
  const overlay = document.getElementById('drawerOverlay')!;
  overlay.setAttribute('aria-hidden', 'true');
  (overlay as HTMLButtonElement).tabIndex = -1;
  document.getElementById('btnSettings')!.setAttribute('aria-expanded', 'false');
  if (drawerReturnFocus && typeof drawerReturnFocus.focus === 'function') {
    drawerReturnFocus.focus();
  }
  drawerReturnFocus = null;
}

export function onDrawerKeydown(e: KeyboardEvent): void {
  const drawer = document.getElementById('drawer')!;
  if (!drawer.classList.contains('open')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDrawer();
    return;
  }
  if (e.key !== 'Tab') return;
  const nodes = [...drawer.querySelectorAll(DRAWER_FOCUSABLE)].filter(
    (el) => !(el as HTMLButtonElement).disabled && (el as HTMLElement).offsetParent !== null
  ) as HTMLElement[];
  if (nodes.length < 2) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
