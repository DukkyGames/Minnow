/**
 * Shared settings page layout helpers (grouped panels, cross-links).
 */

export type SettingsFieldOptions = {
  key: string;
  label: string;
  description?: string;
  control: HTMLElement;
};

/** Single labeled control row with a searchable anchor. */
export function createSettingsField(opts: SettingsFieldOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-field';
  row.dataset.settingsSearchKey = opts.key;

  const label = document.createElement('label');
  label.className = 'settings-field__label';
  label.textContent = opts.label;

  const controlWrap = document.createElement('div');
  controlWrap.className = 'settings-field__control';
  controlWrap.appendChild(opts.control);

  row.append(label, controlWrap);

  if (opts.description) {
    const hint = document.createElement('p');
    hint.className = 'settings-field__hint field-hint';
    hint.textContent = opts.description;
    row.appendChild(hint);
  }

  return row;
}

export type SettingsGroupOptions = {
  /** Bordered panel surface (used on General settings groups). */
  emphasis?: boolean;
};

/** Wrap related controls in a titled panel for scanability. */
export function appendSettingsGroup(
  mount: HTMLElement,
  title: string,
  hint?: string,
  searchKey?: string,
  options?: SettingsGroupOptions,
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'settings-group';
  if (options?.emphasis) {
    group.classList.add('settings-group--emphasis');
  }
  if (searchKey) {
    group.dataset.settingsSearchKey = searchKey;
  }

  const heading = document.createElement('h3');
  heading.className = 'settings-group__title';
  heading.textContent = title;
  group.appendChild(heading);

  if (hint) {
    const lead = document.createElement('p');
    lead.className = 'settings-group__lead';
    lead.textContent = hint;
    group.appendChild(lead);
  }

  const body = document.createElement('div');
  body.className = 'settings-group__body';
  group.appendChild(body);
  mount.appendChild(group);
  return body;
}

/** Related settings links row (hub cross-navigation). */
export function appendSettingsCrosslinks(
  mount: HTMLElement,
  links: { label: string; sectionId: string }[],
): void {
  const cross = document.createElement('div');
  cross.className = 'settings-crosslinks';
  const label = document.createElement('span');
  label.className = 'settings-crosslinks__label';
  label.textContent = 'Related';
  cross.appendChild(label);
  for (const link of links) {
    cross.appendChild(linkToSettingsSection(link.label, link.sectionId));
  }
  mount.appendChild(cross);
}

/** Settings areas that live in the Models app when it is open. */
const MODELS_APP_SECTION_BY_SETTINGS: Partial<Record<string, string>> = {
  providers: 'providers',
  'model-routing': 'routing',
  sampler: 'sampler',
  thinking: 'thinking',
  usage: 'usage',
};

/** Jump to another settings (or Models) section. Uses open APIs, not hash-only. */
export function linkToSettingsSection(
  label: string,
  sectionId: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-inline-link';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    // Models-owned areas always open the Models app (legacy #/settings redirects).
    const modelsSection = MODELS_APP_SECTION_BY_SETTINGS[sectionId];
    if (modelsSection) {
      void import('./models-page').then((m) =>
        m.openModels(modelsSection as import('./models-page').ModelsSectionId),
      );
      return;
    }
    // Call openSettings directly so MinnowOS re-applies the section when the
    // Settings window is already open (hash → #/app/settings is a no-op then).
    void import('./settings-page').then((m) => {
      m.openSettings(sectionId as import('./settings-page-types').SettingsSectionId);
    });
  });
  return btn;
}

/** Jump to a Models app section (e.g. Voice). */
export function linkToModelsSection(
  label: string,
  sectionId: import('./models-page').ModelsSectionId = 'voice',
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-inline-link';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    void import('./models-page').then((m) => m.openModels(sectionId));
  });
  return btn;
}
