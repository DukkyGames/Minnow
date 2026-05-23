/**
 * Full settings page with hash routing (Step 20).
 */

import '../styles/settings-page.css';

import { loadPromptMetaSettings, savePromptMetaSettings } from '../config/prompt-meta';
import {
  backupMemory,
  clearMemory,
  fetchMemoryEnabled,
} from '../memory/client';
import { detectLocalServer } from '../tools/client';
import { refreshSettingsSection } from './settings-sections';
import {
  initSettingsPromptEstimate,
  refreshPromptTokenEstimate,
  schedulePromptTokenEstimateRefresh,
} from './settings-prompt-estimate';
import { setStatus } from './status';
import type { PromptProfile } from '../chat/prompts/types';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from './settings-page-types';

export type { SettingsSectionId } from './settings-page-types';

const SECTIONS = SETTINGS_SECTIONS;

let activeSection: SettingsSectionId = 'general';
let staticBindingsDone = false;

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
  const nextHash = `#/settings/${section}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
  void refreshSettingsSection(section);
  void detectLocalServer().then(() => refreshPromptTokenEstimate());
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

function bindStaticSections(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  const enableEl = document.getElementById(
    'settingsMemoryEnabled',
  ) as HTMLInputElement | null;
  enableEl?.addEventListener('change', async () => {
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
      setStatus(
        ok ? 'ok' : 'err',
        ok ? 'Memory cleared (archived)' : 'Clear failed. Use npm start.',
      );
      if (ok) void refreshSettingsSection('memory');
    });

  document
    .getElementById('settingsMemoryBackup')
    ?.addEventListener('click', async () => {
      const id = await backupMemory();
      setStatus(
        id ? 'ok' : 'err',
        id ? `Memory backup: ${id}` : 'Backup failed. Use npm start.',
      );
    });

  const tabs = document.querySelectorAll('[data-profile-tab]');
  tabs.forEach((tab) => {
    const el = tab as HTMLButtonElement;
    el.addEventListener('click', async () => {
      const profile = el.dataset.profileTab as PromptProfile;
      await savePromptMetaSettings({ activePromptProfile: profile });
      tabs.forEach((t) =>
        (t as HTMLButtonElement).classList.toggle(
          'is-active',
          (t as HTMLButtonElement).dataset.profileTab === profile,
        ),
      );
      setStatus('ok', `Prompt profile: ${profile}`);
      await refreshSettingsSection('prompting');
      schedulePromptTokenEstimateRefresh();
    });
  });

  const memoryInj = document.getElementById(
    'settingsFeatureMemoryInjection',
  ) as HTMLInputElement | null;
  memoryInj?.addEventListener('change', () => {
    void saveFeatureToggle('memoryInjection', memoryInj.checked);
  });
}

async function hydrateStaticFields(): Promise<void> {
  const enableEl = document.getElementById(
    'settingsMemoryEnabled',
  ) as HTMLInputElement | null;
  if (enableEl) {
    enableEl.checked = await fetchMemoryEnabled();
  }

  const meta = await loadPromptMetaSettings();
  document.querySelectorAll('[data-profile-tab]').forEach((tab) => {
    const el = tab as HTMLButtonElement;
    el.classList.toggle(
      'is-active',
      el.dataset.profileTab === meta.activePromptProfile,
    );
  });
}

/** Open full settings page (hash route). */
export function openSettings(section?: SettingsSectionId): void {
  const root = getSettingsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  void import('./global-bugs-page').then((m) => {
    if (m.isGlobalBugsPageOpen()) m.closeGlobalBugs();
  });

  const wasAlreadyOpen = root.classList.contains('is-open');

  root.classList.add('is-open');
  shell.classList.add('hidden');
  document.querySelector('header.topbar')?.classList.add('hidden');
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');

  bindStaticSections();
  initSettingsPromptEstimate();
  void hydrateStaticFields();
  void detectLocalServer().then(() => refreshPromptTokenEstimate());

  const target = section ?? parseHashSection();
  // Skip re-render only when settings was already open on this section (nav uses
  // setActiveSection directly). First open must render even when target is general.
  if (wasAlreadyOpen && target === activeSection) {
    return;
  }
  setActiveSection(target);
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
  if (hash.startsWith('#/bugs')) {
    if (getSettingsRoot()?.classList.contains('is-open')) {
      closeSettings();
    }
    return;
  }
  if (hash.startsWith('#/settings')) {
    void import('./global-bugs-page').then((m) => {
      if (m.isGlobalBugsPageOpen()) m.closeGlobalBugs();
    });
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
