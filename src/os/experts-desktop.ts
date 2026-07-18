/**
 * Desktop experts surface — hero picker (idle) + Experts' Lab panel (active).
 */

import '../styles/experts-hub.css';

import { listExperts, syncExpertRegistryFromServer } from '../chat/experts/registry';
import type { DesktopExpertsActivateOptions } from './desktop-state';
import {
  isDesktopExpertsActive,
  isDesktopExpertsHubActive,
  setDesktopExpertsHubActive,
} from './desktop-state';

function getExpertsMount(): HTMLElement | null {
  return document.getElementById('desktopExpertsMount');
}

function getExpertsHeroMount(): HTMLElement | null {
  return document.getElementById('desktopExpertsHeroMount');
}

function getExpertsView(): HTMLElement | null {
  return document.getElementById('expertsView');
}

function getAppsLayer(): HTMLElement | null {
  return document.getElementById('osAppsLayer');
}

let selectedHeroExpertId: string | null = null;

/** Currently highlighted expert in the desktop hero picker. */
export function getDesktopHeroExpertId(): string | null {
  return selectedHeroExpertId;
}

function ensureExpertsLabBackButton(): void {
  if (document.getElementById('btnExpertsLabBack')) {
    return;
  }
  const newBtn = document.getElementById('btnExpertsNew');
  if (!newBtn) {
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btnExpertsLabBack';
  btn.className = 'experts-hdr-btn';
  btn.textContent = 'Close';
  btn.setAttribute('aria-label', "Close Experts' Lab");
  btn.addEventListener('click', () => {
    closeDesktopExpertsLab();
  });
  newBtn.after(btn);
}

function removeExpertsLabBackButton(): void {
  document.getElementById('btnExpertsLabBack')?.remove();
}

/** Render expert picker buttons + Open Lab control in the desktop hero. */
export function renderDesktopExpertsHero(preselectExpertId?: string | null): void {
  const mount = getExpertsHeroMount();
  if (!mount) {
    return;
  }

  mount.replaceChildren();
  mount.classList.remove('hidden');
  mount.setAttribute('aria-hidden', 'false');

  if (preselectExpertId) {
    selectedHeroExpertId = preselectExpertId;
  }

  const experts = listExperts();
  const grid = document.createElement('div');
  grid.className = 'mn-os-experts-hero-grid';
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', 'Expert specialists');

  if (experts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mn-os-experts-hero-empty';
    empty.textContent = 'No experts yet. Open the lab to compose your first persona.';
    grid.appendChild(empty);
  } else {
    experts.forEach((expert) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mn-os-expert-hero-btn';
      btn.dataset.expertId = expert.meta.id;
      btn.setAttribute('role', 'listitem');
      btn.title = expert.meta.description ?? expert.meta.tagline ?? expert.meta.label;
      btn.classList.toggle('is-selected', expert.meta.id === selectedHeroExpertId);

      const label = document.createElement('span');
      label.className = 'mn-os-expert-hero-label';
      label.textContent = expert.meta.label;

      const role = document.createElement('span');
      role.className = 'mn-os-expert-hero-role';
      role.textContent =
        expert.meta.description ?? expert.meta.tagline ?? 'Expert persona';

      btn.append(label, role);

      btn.addEventListener('click', () => {
        selectedHeroExpertId = expert.meta.id;
        grid.querySelectorAll('.mn-os-expert-hero-btn').forEach((node) => {
          node.classList.toggle(
            'is-selected',
            (node as HTMLElement).dataset.expertId === expert.meta.id,
          );
        });
        void import('../ui/experts/experts-hub').then((m) => m.startExpertChat(expert.meta.id));
      });

      grid.appendChild(btn);
    });
  }

  const actions = document.createElement('div');
  actions.className = 'mn-os-experts-hero-actions';

  const labBtn = document.createElement('button');
  labBtn.type = 'button';
  labBtn.className = 'mn-os-expert-hero-lab-btn';
  labBtn.textContent = "Open Experts' Lab";
  labBtn.addEventListener('click', () => {
    void openDesktopExpertsLab(
      selectedHeroExpertId ? { expertId: selectedHeroExpertId } : undefined,
    );
  });

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'mn-os-expert-hero-new-btn';
  newBtn.textContent = 'New expert';
  newBtn.addEventListener('click', () => {
    void openDesktopExpertsLab({ step: 'create' });
  });

  actions.append(labBtn, newBtn);
  mount.append(grid, actions);
}

function shouldOpenLabOnBootstrap(options?: DesktopExpertsActivateOptions): boolean {
  return Boolean(
    options?.openLab || options?.step === 'create' || options?.step === 'edit',
  );
}

/** Enter desktop experts mode — hero picker first; lab opens on demand. */
export async function bootstrapDesktopExperts(
  options?: DesktopExpertsActivateOptions,
): Promise<void> {
  await syncExpertRegistryFromServer();
  void import('../ui/experts/experts-hub').then((m) => m.refreshExpertsEnabledState());

  renderDesktopExpertsHero(options?.expertId ?? null);

  if (shouldOpenLabOnBootstrap(options)) {
    await openDesktopExpertsLab(options);
  }
}

/** Promote to the full Experts' Lab panel on the desktop stage. */
export async function openDesktopExpertsLab(
  options?: DesktopExpertsActivateOptions,
): Promise<void> {
  const mount = getExpertsMount();
  const view = getExpertsView();
  if (!mount || !view) {
    return;
  }

  if (view.parentElement !== mount) {
    mount.appendChild(view);
  }
  view.classList.add('is-open', 'is-active');
  setDesktopExpertsHubActive(true);
  ensureExpertsLabBackButton();

  const heroMount = getExpertsHeroMount();
  heroMount?.classList.add('hidden');
  heroMount?.setAttribute('aria-hidden', 'true');

  const { openExperts } = await import('../ui/experts/experts-hub');
  openExperts({
    step: options?.step,
    expertId: options?.expertId ?? selectedHeroExpertId ?? undefined,
  });
}

/** Close the lab panel and return to the hero expert picker. */
export function closeDesktopExpertsLab(): void {
  if (!isDesktopExpertsHubActive()) {
    return;
  }

  const view = getExpertsView();
  const appsLayer = getAppsLayer();
  if (view) {
    view.classList.remove('is-open', 'is-active');
    if (appsLayer && view.parentElement !== appsLayer) {
      appsLayer.appendChild(view);
    }
  }

  removeExpertsLabBackButton();
  setDesktopExpertsHubActive(false);

  void import('../ui/experts/experts-hub').then((m) =>
    m.dismissExpertsHubUi(),
  );

  if (isDesktopExpertsActive()) {
    renderDesktopExpertsHero(selectedHeroExpertId);
  }
}

/** Tear down desktop experts overlay when leaving experts mode. */
export function teardownDesktopExperts(): void {
  closeDesktopExpertsLab();

  const view = getExpertsView();
  const appsLayer = getAppsLayer();
  if (view && appsLayer && view.parentElement !== appsLayer) {
    appsLayer.appendChild(view);
  }
  view?.classList.remove('is-open', 'is-active');

  const heroMount = getExpertsHeroMount();
  heroMount?.replaceChildren();
  heroMount?.classList.add('hidden');
  heroMount?.setAttribute('aria-hidden', 'true');
  selectedHeroExpertId = null;

  void import('../ui/experts/experts-hub').then((m) =>
    m.dismissExpertsHubUi(),
  );
}

/** Whether the experts hub is mounted on the desktop overlay. */
export function isDesktopExpertsHubMountedForTests(): boolean {
  const mount = getExpertsMount();
  const view = getExpertsView();
  return Boolean(mount?.contains(view ?? null) && isDesktopExpertsHubActive());
}
