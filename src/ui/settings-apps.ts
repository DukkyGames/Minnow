/**
 * Settings → Apps: toggle which optional MinnowOS apps appear in launchers.
 */

import '../styles/settings-general.css';
import '../styles/app-picker.css';

import {
  listCoreReleasedApps,
  listOptionalReleasedApps,
} from '../os/app-registry';
import { isAppEnabled, setAppEnabled } from '../os/app-preferences';
import { appendAppPickerGroup } from '../os/app-picker-ui';
import { appendSettingsGroup } from './settings-layout';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Render Settings → Apps section. */
export function renderAppsSettingsSection(mount: HTMLElement): void {
  mount.replaceChildren();

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el(
    'p',
    'settings-section-lead',
    'Choose which apps appear in the dock and launchers. Core apps stay on. Changes apply immediately.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const visibility = appendSettingsGroup(
    content,
    'App visibility',
    'Optional apps can be turned off without uninstalling them. Restore them here anytime.',
    'apps.visibility',
    { emphasis: true },
  );

  appendAppPickerGroup(visibility, {
    title: 'Always included',
    description: 'Chat, Models, Brain, and Settings stay available.',
    apps: listCoreReleasedApps(),
    mode: 'always-on',
    isSelected: () => true,
    searchKeyFor: (id) => `apps.core.${id}`,
  });

  appendAppPickerGroup(visibility, {
    title: 'Optional apps',
    description: 'Turn apps off to hide them from the dock, shortcuts, and agent launch choices.',
    apps: listOptionalReleasedApps(),
    mode: 'selectable',
    isSelected: (id) => isAppEnabled(id),
    searchKeyFor: (id) => `apps.optional.${id}`,
    onToggle: (id, selected) => {
      setAppEnabled(id, selected);
    },
  });
}
