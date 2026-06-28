/**
 * Brain full-page app — wiki browser and maintenance sections (MIN-B5).
 */

import '../styles/brain-page.css';
import '../styles/brain-graph.css';

import { isOsAppHash, isOsEmbedded } from '../os/page-bridge';
import { requestCloseWindowApp, registerWindowTeardown } from '../os/window-mounted-apps';
import { navigateToDesktop } from '../os/router';
import { closeBrainInspector } from './brain/inspector';
import { initBrainInspectorResize } from './brain/inspector-resize';
import { renderBrainSection } from './brain/sections';

export type BrainSectionId =
  | 'graph'
  | 'edit'
  | 'log'
  | 'schema'
  | 'proposals'
  | 'memories'
  | 'ingest'
  | 'lint'
  | 'code'
  | 'settings';

/** Legacy hash segment still routed to graph home. */
const LEGACY_SECTION_ALIASES: Record<string, BrainSectionId> = {
  wiki: 'graph',
};

const SECTIONS: BrainSectionId[] = [
  'graph',
  'edit',
  'log',
  'schema',
  'proposals',
  'memories',
  'ingest',
  'lint',
  'code',
  'settings',
];

const SECTION_LABELS: Record<BrainSectionId, string> = {
  graph: 'Graph',
  edit: 'Edit',
  log: 'Log',
  schema: 'Schema',
  proposals: 'Proposals',
  memories: 'Memories',
  ingest: 'Ingest',
  lint: 'Lint',
  code: 'Code',
  settings: 'Settings',
};

/** Section titles shown in the consolidated page header. */
const SECTION_TITLES: Record<BrainSectionId, string> = {
  graph: 'Knowledge graph',
  edit: 'Edit',
  log: 'Log',
  schema: 'Schema',
  proposals: 'Proposals',
  memories: 'Memories',
  ingest: 'Ingest',
  lint: 'Lint',
  code: 'Code',
  settings: 'Settings',
};

/** One-line descriptions for the page header lead line. */
const SECTION_LEADS: Record<BrainSectionId, string> = {
  graph: 'Explore wiki pages, tags, and wikilinks on an interactive canvas.',
  edit: 'Create or update a wiki page (frontmatter + markdown body).',
  log: 'Read-only changelog from log.md.',
  schema: 'View and edit the wiki taxonomy in schema.md.',
  proposals: 'Review AI-suggested memories before they enter the wiki.',
  memories: 'Enable the memory store, manage entries, and control prompt injection.',
  ingest: 'Submit a raw source; the utility model synthesizes wiki pages.',
  lint: 'Health report: orphans, stale pages, broken links, contradictions.',
  code: 'Browse the indexed repo map, search symbols, and inspect call graphs.',
  settings: 'Memory synthesis cadence, semantic embeddings, and code index settings.',
};

let activeSection: BrainSectionId = 'graph';
let staticBindingsDone = false;

function getBrainRoot(): HTMLElement | null {
  return document.getElementById('brainView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function resolveSectionId(raw: string | undefined): BrainSectionId {
  if (!raw) return 'graph';
  if (SECTIONS.includes(raw as BrainSectionId)) return raw as BrainSectionId;
  return LEGACY_SECTION_ALIASES[raw] ?? 'graph';
}

function parseHashSection(): BrainSectionId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const match = hash.match(/^(?:app\/brain|brain)(?:\/([\w-]+))?/);
  return resolveSectionId(match?.[1]);
}

function updatePageHeader(section: BrainSectionId): void {
  const titleEl = document.getElementById('brainPageHeaderTitle');
  const leadEl = document.getElementById('brainPageHeaderLead');
  const backBtn = document.getElementById('btnBrainPageBack');
  if (titleEl) titleEl.textContent = SECTION_TITLES[section];
  if (leadEl) leadEl.textContent = SECTION_LEADS[section];
  backBtn?.classList.toggle('hidden', isOsEmbedded());
}

/** Populate the header action slot (cleared on every section switch). */
export function setBrainHeaderActions(...nodes: Node[]): void {
  const mount = document.getElementById('brainPageHeaderActions');
  if (!mount) return;
  mount.replaceChildren(...nodes);
}

export function clearBrainHeaderActions(): void {
  setBrainHeaderActions();
}

function setActiveSection(section: BrainSectionId, options?: { editPath?: string }): void {
  const prevSection = activeSection;
  activeSection = section;
  updatePageHeader(section);
  clearBrainHeaderActions();
  getBrainRoot()?.classList.toggle('is-graph-canvas-bg', section === 'graph');
  for (const id of SECTIONS) {
    const panel = document.getElementById(`brainSection-${id}`);
    const nav = document.querySelector(
      `[data-brain-nav="${id}"]`,
    ) as HTMLButtonElement | null;
    panel?.classList.toggle('is-active', id === section);
    nav?.setAttribute('aria-current', id === section ? 'page' : 'false');
  }

  if (prevSection !== section) {
    const inspector = document.getElementById('brainInspector');
    if (inspector) closeBrainInspector(inspector);
  }

  const nextHash = `#/app/brain/${section}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
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
  void import('./code-brain-map').then((m) => m.closeCodeBrainMap());

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
    updatePageHeader(target);
    void renderBrainSection(target, options);
    return;
  }
  setActiveSection(target, options);
}

/** Jump to Edit with a pre-filled wiki path. */
export function openBrainEditForPath(relPath: string): void {
  openBrain('edit', { editPath: relPath });
}

/** Open Edit for a new wiki page (manual creation entry point). */
export function openBrainNewPage(): void {
  openBrain('edit', { editPath: 'facts/' });
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  pathEl?.focus();
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
  openBrain('graph');
}

export function isBrainPageOpen(): boolean {
  return Boolean(getBrainRoot()?.classList.contains('is-open'));
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/app/brain') || hash.startsWith('#/brain')) {
    const section = parseHashSection();
    // setActiveSection already updated activeSection + rendered before syncing hash.
    if (isBrainPageOpen() && section === activeSection) {
      return;
    }
    openBrain(section);
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
  initBrainInspectorResize();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.includes('/brain')) {
    openBrain(parseHashSection());
  }
}

export { SECTION_LABELS, SECTION_TITLES, SECTION_LEADS, SECTIONS };
