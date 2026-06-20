/**
 * Models full-page app — hardware recommendations + moved provider/model settings.
 */

import '../styles/models-page.css';

import { isOsAppHash, isOsEmbedded } from '../os/page-bridge';
import { requestCloseWindowApp, registerWindowTeardown } from '../os/window-mounted-apps';
import { navigateToDesktop } from '../os/router';
import { renderModelsSection } from './models-sections';

export type ModelsSectionId =
  | 'recommend'
  | 'installed'
  | 'settings'
  | 'voice'
  | 'providers'
  | 'routing'
  | 'sampler'
  | 'thinking'
  | 'usage';

const SECTIONS: ModelsSectionId[] = [
  'recommend',
  'installed',
  'settings',
  'voice',
  'providers',
  'routing',
  'sampler',
  'thinking',
  'usage',
];

const SECTION_LABELS: Record<ModelsSectionId, string> = {
  recommend: 'Recommendations',
  installed: 'Installed',
  settings: 'Library',
  voice: 'Voice',
  providers: 'Providers',
  routing: 'Routing',
  sampler: 'Sampler',
  thinking: 'Thinking',
  usage: 'Usage & cost',
};

let activeSection: ModelsSectionId = 'recommend';
let staticBindingsDone = false;

function getModelsRoot(): HTMLElement | null {
  return document.getElementById('modelsView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function parseHashSection(): ModelsSectionId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const match = hash.match(/^(?:app\/models|models)(?:\/([\w-]+))?/);
  const id = match?.[1] as ModelsSectionId | undefined;
  if (id && SECTIONS.includes(id)) return id;
  return 'recommend';
}

function setActiveSection(section: ModelsSectionId): void {
  activeSection = section;
  for (const id of SECTIONS) {
    const panel = document.getElementById(`modelsSection-${id}`);
    const nav = document.querySelector(
      `[data-models-nav="${id}"]`,
    ) as HTMLButtonElement | null;
    panel?.classList.toggle('is-active', id === section);
    nav?.setAttribute('aria-current', id === section ? 'page' : 'false');
  }

  if (!isOsEmbedded()) {
    const nextHash = `#/app/models/${section}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  void renderModelsSection(section);
}

function bindStaticSections(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  document.getElementById('btnModelsPageBack')?.addEventListener('click', () => {
    if (requestCloseWindowApp('models')) return;
    closeModels();
  });

  for (const id of SECTIONS) {
    document
      .querySelector(`[data-models-nav="${id}"]`)
      ?.addEventListener('click', () => setActiveSection(id));
  }
}

function closeOtherFullPages(): void {
  void import('./experts/experts-hub').then((m) => {
    if (m.isExpertsPageOpen()) m.closeExpertsHub({ skipNavigate: true });
  });
  void import('./global-bugs-page').then((m) => {
    if (m.isGlobalBugsPageOpen()) m.closeGlobalBugs();
  });
  void import('./welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) m.closeWelcome({ skipHash: true });
  });
  void import('../research/panel').then((m) => {
    if (m.isResearchPageOpen()) m.closeResearch({ skipNavigate: true });
  });
  void import('./compare-page').then((m) => {
    if (m.isComparePageOpen()) m.closeCompare({ skipNavigate: true });
  });
  void import('./benchmark-page').then((m) => {
    const root = document.getElementById('benchmarkView');
    if (root?.classList.contains('is-open')) m.closeBenchmark({ skipNavigate: true });
  });
  void import('./brain-page').then((m) => {
    if (m.isBrainPageOpen()) m.closeBrain({ skipNavigate: true });
  });
  void import('./settings-page').then((m) => {
    const settingsRoot = document.getElementById('settingsView');
    if (settingsRoot?.classList.contains('is-open')) m.closeSettings({ skipNavigate: true });
  });
}

/** Open the Models app (optional section deep link). */
export function openModels(section?: ModelsSectionId): void {
  const root = getModelsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  closeOtherFullPages();

  const wasAlreadyOpen = root.classList.contains('is-open');
  root.classList.add('is-open');

  if (!isOsEmbedded()) {
    shell.classList.add('hidden');
    document.querySelector('header.topbar')?.classList.add('hidden');
  }

  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

  bindStaticSections();

  const target = section ?? parseHashSection();
  // OS router may open a deep link before initApp finishes; refresh when already active.
  if (wasAlreadyOpen && target === activeSection) {
    void renderModelsSection(target);
    return;
  }
  setActiveSection(target);
}

/** Close Models and return to chat or desktop. */
export function closeModels(options?: { skipNavigate?: boolean }): void {
  const root = getModelsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  root.classList.remove('is-open');

  if (!isOsEmbedded()) {
    shell.classList.remove('hidden');
    document.querySelector('header.topbar')?.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.includes('/models')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    if (!requestCloseWindowApp('models')) {
      navigateToDesktop();
    }
  }

  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

export function openModelsFromTopbar(): void {
  openModels('recommend');
}

export function isModelsPageOpen(): boolean {
  return Boolean(getModelsRoot()?.classList.contains('is-open'));
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/app/models') || hash.startsWith('#/models')) {
    openModels(parseHashSection());
    return;
  }
  if (isOsEmbedded() && isOsAppHash(hash)) return;
  if (getModelsRoot()?.classList.contains('is-open')) {
    closeModels();
  }
}

export function initModelsPage(): void {
  registerWindowTeardown('models', () => closeModels({ skipNavigate: true }));
  bindStaticSections();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.includes('/models')) {
    openModels(parseHashSection());
  }
}

export { SECTION_LABELS };
