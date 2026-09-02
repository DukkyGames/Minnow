import '../styles/settings-general.css';
import '../styles/settings-appearance.css';

import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { appendAppearanceThemePresets } from './settings-appearance-theme';
import { appendAppearanceCustomColors } from './settings-appearance-colors';
import { appendAppearanceFonts } from './settings-appearance-fonts';

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

/** Miniature chat bench that reflects live theme tokens. */
function appendAppearanceLivePreview(mount: HTMLElement): void {
  const figure = el('figure', 'settings-appearance-preview');
  figure.setAttribute('aria-label', 'Theme preview');

  figure.appendChild(el('figcaption', 'settings-appearance-preview__label', 'Live preview'));

  const bench = el('div', 'settings-appearance-preview__bench');

  const thread = el('div', 'settings-appearance-preview__thread');
  thread.append(
    el('div', 'settings-appearance-preview__msg settings-appearance-preview__msg--user', 'Summarize this diff'),
    el(
      'div',
      'settings-appearance-preview__msg settings-appearance-preview__msg--asst',
      'Three files changed, mostly styling.',
    ),
  );

  const composer = el('div', 'settings-appearance-preview__composer');
  composer.append(
    el('span', 'settings-appearance-preview__input', 'Message…'),
    el('span', 'settings-appearance-preview__send', 'Send'),
    el('span', 'settings-appearance-preview__chip', '42 t/s'),
  );

  bench.append(thread, composer);
  figure.appendChild(bench);
  mount.appendChild(figure);
}

/** Render full Appearance settings section. */
export function renderAppearanceSettingsSection(mount: HTMLElement): void {
  mount.replaceChildren();

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Palette and typography. Terminals and LAN access live under ',
    linkToSettingsSection('General', 'general'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const presets = appendSettingsGroup(
    content,
    'Theme presets',
    'Eight palette families with dark and light modes, or follow the system appearance.',
    'appearance.theme',
    { emphasis: true },
  );
  appendAppearanceLivePreview(presets);
  appendAppearanceThemePresets(presets);

  const fonts = appendSettingsGroup(
    content,
    'Fonts',
    'UI and monospace stacks, or upload your own web fonts.',
    'appearance.fonts',
    { emphasis: true },
  );
  appendAppearanceFonts(fonts);

  const customColors = appendSettingsGroup(
    content,
    'Custom colors',
    'Pick four colors or expand advanced mode to override every palette token.',
    'appearance.customColors',
    { emphasis: true },
  );
  appendAppearanceCustomColors(customColors);
}
