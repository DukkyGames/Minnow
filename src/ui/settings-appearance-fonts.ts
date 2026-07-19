import { appAlert, appConfirm, appPrompt } from './app-dialog';
/**

 * Settings → Appearance: UI and monospace font presets + uploads.

 */



import { saveAppearanceAsset } from '../appearance/asset-store';

import {

  applyAppearanceFonts,

  getAppearanceFonts,

  setAppearanceFonts,

  MONO_FONT_LABELS,

  MONO_FONT_PRESETS,

  setMonoFont,

  setUiFont,

  UI_FONT_LABELS,

  UI_FONT_PRESETS,

} from '../appearance/fonts';

import type { MonoFontPresetId, UiFontPresetId } from '../appearance/types';



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



function buildPresetSelect<T extends string>(

  options: readonly T[],

  labels: Record<T, string>,

  value: T,

  onChange: (id: T) => void,

): HTMLSelectElement {

  const select = el('select', 'settings-select settings-appearance-font-select');

  for (const id of options) {

    const opt = document.createElement('option');

    opt.value = id;

    opt.textContent = labels[id];

    if (id === value) opt.selected = true;

    select.appendChild(opt);

  }

  select.addEventListener('change', () => onChange(select.value as T));

  return select;

}



function appendFontRow(

  mount: HTMLElement,

  label: string,

  select: HTMLSelectElement,

  onUpload: (file: File) => Promise<void>,

): void {

  const row = el('div', 'settings-appearance-font-row');

  row.appendChild(el('span', 'settings-appearance-font-row__label', label));

  row.appendChild(select);



  const uploadLabel = el('label', 'settings-action-btn settings-appearance-font-upload');

  uploadLabel.textContent = 'Upload font';

  const input = document.createElement('input');

  input.type = 'file';

  input.accept = '.woff2,.woff,.ttf,.otf,font/woff2,font/woff';

  input.hidden = true;

  input.addEventListener('change', async () => {

    const file = input.files?.[0];

    input.value = '';

    if (!file) return;

    try {

      await onUpload(file);

    } catch (err) {

      const msg = err instanceof Error ? err.message : String(err);

      await appAlert(msg);

    }

  });

  uploadLabel.appendChild(input);

  uploadLabel.addEventListener('click', () => input.click());

  row.appendChild(uploadLabel);

  mount.appendChild(row);

}



/** Mount font preset dropdowns, specimen preview, and upload controls. */

export function appendAppearanceFonts(mount: HTMLElement): void {

  const specimen = el('div', 'settings-appearance-font-specimen');



  const uiBlock = el('div', 'settings-appearance-font-specimen__block');

  uiBlock.appendChild(el('span', 'settings-appearance-font-specimen__label', 'UI'));

  const preview = el('p', 'settings-appearance-font-preview');

  preview.style.fontFamily = 'var(--font-ui)';

  preview.textContent = 'The quick brown fox jumps over the lazy dog. 0123456789';

  uiBlock.appendChild(preview);



  const monoBlock = el('div', 'settings-appearance-font-specimen__block');

  monoBlock.appendChild(el('span', 'settings-appearance-font-specimen__label', 'Mono'));

  const monoPreview = el(

    'pre',

    'settings-appearance-font-preview settings-appearance-font-preview--mono',

  );

  monoPreview.style.fontFamily = 'var(--font-mono)';

  monoPreview.textContent = 'const minnow = "swimming"; // mono preview';

  monoBlock.appendChild(monoPreview);



  specimen.append(uiBlock, monoBlock);

  mount.appendChild(specimen);



  function refreshPreview(): void {

    preview.style.fontFamily = getComputedStyle(document.documentElement)

      .getPropertyValue('--font-ui')

      .trim();

    monoPreview.style.fontFamily = getComputedStyle(document.documentElement)

      .getPropertyValue('--font-mono')

      .trim();

  }



  const fonts = getAppearanceFonts();

  let uiId: UiFontPresetId = 'system';

  if (fonts.ui.kind === 'preset' && fonts.ui.slot === 'ui') {

    uiId = fonts.ui.id;

  }

  let monoId: MonoFontPresetId = 'system';

  if (fonts.mono.kind === 'preset' && fonts.mono.slot === 'mono') {

    monoId = fonts.mono.id;

  }



  const controls = el('div', 'settings-appearance-font-controls');



  const uiSelect = buildPresetSelect<UiFontPresetId>(

    UI_FONT_PRESETS,

    UI_FONT_LABELS,

    uiId,

    (id) => {

      setUiFont({ kind: 'preset', slot: 'ui', id });

      refreshPreview();

    },

  );



  const monoSelect = buildPresetSelect<MonoFontPresetId>(

    MONO_FONT_PRESETS,

    MONO_FONT_LABELS,

    monoId,

    (id) => {

      setMonoFont({ kind: 'preset', slot: 'mono', id });

      refreshPreview();

    },

  );



  appendFontRow(controls, 'UI font', uiSelect, async (file) => {

    const assetId = await saveAppearanceAsset('font', file);

    const base = file.name.replace(/\.[^.]+$/, '');

    const familyName = `MinnowUI_${base.replace(/\W+/g, '_')}`;

    setUiFont({ kind: 'upload', slot: 'ui', assetId, familyName });

    uiSelect.value = 'system';

    refreshPreview();

  });



  appendFontRow(controls, 'Monospace font', monoSelect, async (file) => {

    const assetId = await saveAppearanceAsset('font', file);

    const base = file.name.replace(/\.[^.]+$/, '');

    const familyName = `MinnowMono_${base.replace(/\W+/g, '_')}`;

    setMonoFont({ kind: 'upload', slot: 'mono', assetId, familyName });

    monoSelect.value = 'system';

    refreshPreview();

  });



  if (fonts.ui.kind === 'upload' || fonts.mono.kind === 'upload') {

    const hint = el(

      'p',

      'settings-field-hint',

      'Custom uploaded fonts are stored in this browser (IndexedDB).',

    );

    controls.appendChild(hint);

  }



  const resetBtn = el('button', 'settings-action-btn', 'Reset fonts to default');

  resetBtn.type = 'button';

  resetBtn.addEventListener('click', () => {

    setAppearanceFonts({

      ui: { kind: 'preset', slot: 'ui', id: 'system' },

      mono: { kind: 'preset', slot: 'mono', id: 'system' },

    });

    void applyAppearanceFonts();

    uiSelect.value = 'system';

    monoSelect.value = 'system';

    refreshPreview();

  });

  controls.appendChild(resetBtn);

  mount.appendChild(controls);



  refreshPreview();

}


