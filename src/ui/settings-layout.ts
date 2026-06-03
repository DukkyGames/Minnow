/**
 * Shared settings page layout helpers (grouped panels, cross-links).
 */

/** Wrap related controls in a titled panel for scanability. */
export function appendSettingsGroup(
  mount: HTMLElement,
  title: string,
  hint?: string,
  searchKey?: string,
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'settings-group';
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

/** Jump to another settings section via hash (works before page is open). */
export function linkToSettingsSection(
  label: string,
  sectionId: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-inline-link';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    window.location.hash = `#/settings/${sectionId}`;
  });
  return btn;
}
