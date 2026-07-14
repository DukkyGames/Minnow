/**

 * Settings → Appearance section composer.

 */



import '../styles/settings-appearance.css';



import { appendSettingsGroup } from './settings-layout';

import { appendAppearanceThemePresets } from './settings-appearance-theme';

import { appendAppearanceCustomColors } from './settings-appearance-colors';

import { appendAppearanceFonts } from './settings-appearance-fonts';

import { appendAppearanceWallpaper } from './settings-appearance-wallpaper';

import { isCustomThemeEnabled } from '../appearance/custom-theme';



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



/** Wrap advanced custom color controls in a collapsible panel. */

function appendCustomColorsGroup(mount: HTMLElement): void {

  const details = el('details', 'settings-appearance-advanced');

  details.open = isCustomThemeEnabled();



  const summary = document.createElement('summary');

  summary.className = 'settings-appearance-advanced__summary';

  summary.append(

    el('span', 'settings-appearance-advanced__title', 'Custom colors'),

    el(

      'span',

      'settings-appearance-advanced__hint',

      'Pick four colors or expand advanced mode to override every palette token.',

    ),

  );

  details.appendChild(summary);



  const body = el('div', 'settings-appearance-advanced__body');

  appendAppearanceCustomColors(body);

  details.appendChild(body);

  mount.appendChild(details);

}



/** Render full Appearance settings section. */

export function renderAppearanceSettingsSection(mount: HTMLElement): void {

  mount.replaceChildren();



  const shell = el('div', 'settings-appearance');

  mount.appendChild(shell);



  shell.appendChild(

    el(

      'p',

      'settings-section-lead',

      'Palette, typography, and the MinnowOS desktop background. Wallpapers show behind open apps on the blurred desktop.',

    ),

  );



  appendAppearanceLivePreview(shell);



  const presets = appendSettingsGroup(

    shell,

    'Theme presets',

    'Four palette families with dark and light modes, or follow the system appearance.',

  );

  appendAppearanceThemePresets(presets);



  const wallpaper = appendSettingsGroup(

    shell,

    'Desktop wallpaper',

    'Ambient backgrounds on the MinnowOS desktop. Default is Underwater.',

  );

  appendAppearanceWallpaper(wallpaper);



  const fonts = appendSettingsGroup(

    shell,

    'Fonts',

    'UI and monospace stacks, or upload your own web fonts.',

  );

  appendAppearanceFonts(fonts);



  appendCustomColorsGroup(shell);

}


