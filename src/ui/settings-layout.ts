/**
 * Shared settings page layout helpers (grouped panels, cross-links).
 */

/** Wrap related controls in a titled panel for scanability. */
export function appendSettingsGroup(
  mount: HTMLElement,
  title: string,
  hint?: string,
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'settings-group';

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
