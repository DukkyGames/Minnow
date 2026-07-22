/**
 * Settings → Apps: toggle which optional MinnowOS apps appear in launchers.
 */

import '../styles/settings-general.css';
import '../styles/app-picker.css';

import {
  listCoreReleasedApps,
  listOptionalReleasedApps,
} from '../os/app-registry';
import { isAppEnabled, setAppEnabled, setEnabledOptionalApps } from '../os/app-preferences';
import { appendAppPickerCoreNote, appendAppPickerGroup } from '../os/app-picker-ui';
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

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const visibility = appendSettingsGroup(
    content,
    'App visibility',
    'Hide optional apps from the dock and launchers. Restore anytime.',
    'apps.visibility',
    { emphasis: true },
  );

  appendAppPickerCoreNote(visibility, {
    apps: listCoreReleasedApps(),
    searchKeyFor: (id) => `apps.core.${id}`,
  });

  const optionalApps = listOptionalReleasedApps();

  appendAppPickerGroup(visibility, {
    title: 'Optional apps',
    apps: optionalApps,
    mode: 'selectable',
    isSelected: (id) => isAppEnabled(id),
    searchKeyFor: (id) => `apps.optional.${id}`,
    onToggle: (id, selected) => {
      setAppEnabled(id, selected);
    },
    onBulkSet: (selected) => {
      setEnabledOptionalApps(selected ? optionalApps.map((app) => app.id) : []);
    },
  });
}
