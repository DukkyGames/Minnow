/**
 * Full settings page with hash routing (Step 20).
 */

import { loadPromptMetaSettings, savePromptMetaSettings } from '../config/prompt-meta';
import {
  backupMemory,
  clearMemory,
  fetchMemoryEnabled,
} from '../memory/client';
import { detectLocalServer } from '../tools/client';
import { setStatus } from './status';
import type { PromptProfile } from '../chat/prompts/types';

export type SettingsSectionId =
  | 'general'
  | 'prompting'
  | 'providers'
  | 'memory'
  | 'features'
  | 'tools'
  | 'mcp'
  | 'lsp';

const SECTIONS: SettingsSectionId[] = [
  'general',
  'prompting',
  'providers',
  'memory',
  'features',
  'tools',
  'mcp',
  'lsp',
];

let activeSection: SettingsSectionId = 'general';

function getSettingsRoot(): HTMLElement | null {
  return document.getElementById('settingsView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function parseHashSection(): SettingsSectionId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const match = hash.match(/^settings(?:\/([\w-]+))?/);
  const id = match?.[1] as SettingsSectionId | undefined;
  if (id && SECTIONS.includes(id)) return id;
  return 'general';
}

function setActiveSection(section: SettingsSectionId): void {
  activeSection = section;
  for (const id of SECTIONS) {
    const panel = document.getElementById(`settingsSection-${id}`);
    const nav = document.querySelector(
      `[data-settings-nav="${id}"]`,
    ) as HTMLButtonElement | null;
    if (panel) {
      panel.classList.toggle('is-active', id === section);
    }
    if (nav) {
      nav.setAttribute('aria-current', id === section ? 'page' : 'false');
    }
  }
  window.location.hash = `#/settings/${section}`;
}

async function saveFeatureToggle(
  key: string,
  enabled: boolean,
): Promise<void> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return;
    const config = (await res.json()) as Record<string, unknown>;
    const features =
      config.features && typeof config.features === 'object'
        ? { ...(config.features as Record<string, boolean>) }
        : {};
    features[key] = enabled;
    config.features = features;
    await fetch('/api/config/file?key=config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  } catch {
    /* offline */
  }
}

async function bindMemorySection(): Promise<void> {
  const enableEl = document.getElementById(
    'settingsMemoryEnabled',
  ) as HTMLInputElement | null;
  if (!enableEl) return;

  const enabled = await fetchMemoryEnabled();
  enableEl.checked = enabled;

  enableEl.addEventListener('change', async () => {
    try {
      const res = await fetch('/api/config/file?key=config.json');
      if (!res.ok) return;
      const config = await res.json();
      config.memory = {
        ...(config.memory ?? {}),
        enabled: enableEl.checked,
      };
      await fetch('/api/config/file?key=config.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setStatus('ok', enableEl.checked ? 'Memory enabled' : 'Memory disabled');
    } catch {
      setStatus('err', 'Memory settings require npm start');
    }
  });

  document
    .getElementById('settingsMemoryClear')
    ?.addEventListener('click', async () => {
      if (!confirm('Clear all memory entries?')) return;
      const ok = await clearMemory(true);
      setStatus(ok ? 'ok' : 'err', ok ? 'Memory cleared (archived)' : 'Clear failed — use npm start');
    });

  document
    .getElementById('settingsMemoryBackup')
    ?.addEventListener('click', async () => {
      const id = await backupMemory();
      setStatus(id ? 'ok' : 'err', id ? `Memory backup: ${id}` : 'Backup failed — use npm start');
    });
}

async function bindPromptingSection(): Promise<void> {
  const meta = await loadPromptMetaSettings();
  const tabs = document.querySelectorAll('[data-profile-tab]');
  tabs.forEach((tab) => {
    const el = tab as HTMLButtonElement;
    const profile = el.dataset.profileTab as PromptProfile;
    el.classList.toggle('is-active', profile === meta.activePromptProfile);
    el.addEventListener('click', async () => {
      await savePromptMetaSettings({ activePromptProfile: profile });
      tabs.forEach((t) =>
        (t as HTMLButtonElement).classList.toggle(
          'is-active',
          (t as HTMLButtonElement).dataset.profileTab === profile,
        ),
      );
      setStatus('ok', `Prompt profile: ${profile}`);
    });
  });
}

async function bindFeaturesSection(): Promise<void> {
  const selfHeal = document.getElementById(
    'settingsSelfHealingEnabled',
  ) as HTMLInputElement | null;
  if (!selfHeal) return;

  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (res.ok) {
      const config = await res.json();
      selfHeal.checked = config.selfHealing?.enabled === true;
    }
  } catch {
    /* ignore */
  }

  selfHeal.addEventListener('change', async () => {
    try {
      const res = await fetch('/api/config/file?key=config.json');
      if (!res.ok) return;
      const config = await res.json();
      config.selfHealing = {
        ...(config.selfHealing ?? {}),
        enabled: selfHeal.checked,
      };
      await fetch('/api/config/file?key=config.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setStatus('ok', selfHeal.checked ? 'Self-healing enabled' : 'Self-healing disabled');
    } catch {
      setStatus('err', 'Self-healing settings require npm start');
    }
  });

  const memoryInj = document.getElementById(
    'settingsFeatureMemoryInjection',
  ) as HTMLInputElement | null;
  memoryInj?.addEventListener('change', () => {
    void saveFeatureToggle('memoryInjection', memoryInj.checked);
  });
}

/** Open full settings page (hash route). */
export function openSettings(section?: SettingsSectionId): void {
  const root = getSettingsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  root.classList.add('is-open');
  shell.classList.add('hidden');
  document.querySelector('header.topbar')?.classList.add('hidden');
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');

  setActiveSection(section ?? parseHashSection());
  void bindMemorySection();
  void bindPromptingSection();
  void bindFeaturesSection();
}

/** Close settings and return to chat. */
export function closeSettings(): void {
  const root = getSettingsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  document.querySelector('header.topbar')?.classList.remove('hidden');
  window.location.hash = '#/';
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/settings')) {
    openSettings(parseHashSection());
    return;
  }
  if (getSettingsRoot()?.classList.contains('is-open')) {
    closeSettings();
  }
}

/** Wire nav, back button, and hash routing. */
export function initSettingsPage(): void {
  document
    .getElementById('btnSettingsPageBack')
    ?.addEventListener('click', () => closeSettings());

  for (const id of SECTIONS) {
    document
      .querySelector(`[data-settings-nav="${id}"]`)
      ?.addEventListener('click', () => setActiveSection(id));
  }

  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.startsWith('#/settings')) {
    openSettings(parseHashSection());
  }

  void detectLocalServer();
}

/** Topbar gear opens full settings instead of drawer when available. */
export function openSettingsFromTopbar(): void {
  openSettings('general');
}
