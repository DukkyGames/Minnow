/**
 * Brain full-page app — wiki browser and maintenance sections (MIN-B5).
 */

import '../styles/brain-page.css';

import { isOsAppHash, isOsEmbedded } from '../os/page-bridge';
import { requestCloseWindowApp, registerWindowTeardown } from '../os/window-mounted-apps';
import { navigateToDesktop } from '../os/router';
import { renderBrainSection } from './brain/sections';

export type BrainSectionId =
  | 'wiki'
  | 'edit'
  | 'log'
  | 'schema'
  | 'proposals'
  | 'ingest'
  | 'lint'
  | 'code'
  | 'settings';

const SECTIONS: BrainSectionId[] = [
  'wiki',
  'edit',
  'log',
  'schema',
  'proposals',
  'ingest',
  'lint',
  'code',
  'settings',
];

const SECTION_LABELS: Record<BrainSectionId, string> = {
  wiki: 'Wiki',
  edit: 'Edit',
  log: 'Log',
  schema: 'Schema',
  proposals: 'Proposals',
  ingest: 'Ingest',
  lint: 'Lint',
  code: 'Code',
  settings: 'Settings',
};

let activeSection: BrainSectionId = 'wiki';
let staticBindingsDone = false;

function getBrainRoot(): HTMLElement | null {
  return document.getElementById('brainView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function parseHashSection(): BrainSectionId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const match = hash.match(/^(?:app\/brain|brain)(?:\/([\w-]+))?/);
  const id = match?.[1] as BrainSectionId | undefined;
  if (id && SECTIONS.includes(id)) return id;
  return 'wiki';
}

function setActiveSection(section: BrainSectionId, options?: { editPath?: string }): void {
  activeSection = section;
  for (const id of SECTIONS) {
    const panel = document.getElementById(`brainSection-${id}`);
    const nav = document.querySelector(
      `[data-brain-nav="${id}"]`,
    ) as HTMLButtonElement | null;
    panel?.classList.toggle('is-active', id === section);
    nav?.setAttribute('aria-current', id === section ? 'page' : 'false');
  }

  if (!isOsEmbedded()) {
    const nextHash = `#/app/brain/${section}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  void renderBrainSection(section, options);
}

function bindStaticSections(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  document.getElementById('btnBrainPageBack')?.addEventListener('click', () => {
    if (requestCloseWindowApp('brain')) return;
    closeBrain();
  });

  for (const id of SECTIONS) {
    document
      .querySelector(`[data-brain-nav="${id}"]`)
      ?.addEventListener('click', () => setActiveSection(id));
  }
}

function closeOtherFullPages(): void {
  void import('./models-page').then((m) => {
    if (m.isModelsPageOpen()) m.closeModels({ skipNavigate: true });
  });
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
  void import('./settings-page').then((m) => {
    const settingsRoot = document.getElementById('settingsView');
    if (settingsRoot?.classList.contains('is-open')) m.closeSettings({ skipNavigate: true });
  });
}

/** Open the Brain app (optional section deep link). */
export function openBrain(section?: BrainSectionId, options?: { editPath?: string }): void {
  const root = getBrainRoot();
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
  if (wasAlreadyOpen && target === activeSection && !options?.editPath) {
    void renderBrainSection(target, options);
    return;
  }
  setActiveSection(target, options);
}

/** Jump to Edit with a pre-filled wiki path. */
export function openBrainEditForPath(relPath: string): void {
  openBrain('edit', { editPath: relPath });
}

/** Close Brain and return to chat or desktop. */
export function closeBrain(options?: { skipNavigate?: boolean }): void {
  const root = getBrainRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  root.classList.remove('is-open');

  if (!isOsEmbedded()) {
    shell.classList.remove('hidden');
    document.querySelector('header.topbar')?.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.includes('/brain')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    if (!requestCloseWindowApp('brain')) {
      navigateToDesktop();
    }
  }

  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

export function openBrainFromTopbar(): void {
  openBrain('wiki');
}

export function isBrainPageOpen(): boolean {
  return Boolean(getBrainRoot()?.classList.contains('is-open'));
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/app/brain') || hash.startsWith('#/brain')) {
    openBrain(parseHashSection());
    return;
  }
  if (isOsEmbedded() && isOsAppHash(hash)) return;
  if (getBrainRoot()?.classList.contains('is-open')) {
    closeBrain();
  }
}

export function initBrainPage(): void {
  registerWindowTeardown('brain', () => closeBrain({ skipNavigate: true }));
  bindStaticSections();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.includes('/brain')) {
    openBrain(parseHashSection());
  }
}

export { SECTION_LABELS };
