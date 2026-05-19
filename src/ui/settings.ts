import {
  PRESET_STORAGE_KEY,
  SYSTEM_PROMPT_PRESETS,
} from '../constants';
import {
  activeSystemPromptPresetId,
  setActiveSystemPromptPresetId,
  setSuppressSystemPromptSelectChange,
  suppressSystemPromptSelectChange,
} from '../app-state';

const DRAWER_FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let drawerReturnFocus: HTMLElement | null = null;

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

export function saveSystemPromptSettings(): void {
  try {
    localStorage.setItem(
      PRESET_STORAGE_KEY,
      JSON.stringify({
        presetId: activeSystemPromptPresetId,
        text: (document.getElementById('systemPrompt') as HTMLTextAreaElement).value,
      })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadSystemPromptSettings(): void {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as { text?: string; presetId?: string };
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
  } catch {
    /* ignore corrupt storage */
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
