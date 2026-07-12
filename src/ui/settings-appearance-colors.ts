/**

 * Settings → Appearance: custom color token editor.

 */



import {

  formatCssColor,

  parseCssColorOrDefault,

  rgbaToColorInputValue,

} from '../appearance/color-format';

import {

  exportCustomThemeJson,

  getCustomThemeTokens,

  importCustomThemeJson,

  isCustomThemeEnabled,

  readEffectiveThemeTokens,

  readPresetTokenValue,

  replaceCustomThemeTokens,

  resetCustomTheme,

  setCustomThemeEnabled,

  setCustomThemeTokens,

} from '../appearance/custom-theme';

import { warnContrastPairs } from '../appearance/contrast';

import {

  CORE_THEME_TOKEN_KEYS,

  THEME_TOKEN_GROUPS,

  type CoreThemeTokenKey,

} from '../appearance/types';

import { applyResolvedTheme } from './theme';

import { getStoredTheme } from '../theme';

import { createSettingsToggleRow } from './settings-switch';

import { setStatus } from './status';



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



/** Trigger a browser download for a text payload (Electron-safe). */
function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function labelForKey(key: CoreThemeTokenKey): string {

  return key

    .split('-')

    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))

    .join(' ');

}



interface ColorTokenControl {

  root: HTMLElement;

  getValue: () => string;

  setValue: (css: string) => void;

  setDisabled: (disabled: boolean) => void;

}



/** One token row: native color swatch, alpha slider, and formatted CSS readout. */

function createColorTokenControl(

  key: CoreThemeTokenKey,

  onChange: (value: string) => void,

): ColorTokenControl {

  let current = parseCssColorOrDefault('');



  const field = el('label', 'settings-appearance-color-field');

  field.appendChild(el('span', 'settings-appearance-color-field__label', labelForKey(key)));



  const control = el('div', 'settings-appearance-color-control');



  const swatch = document.createElement('input');

  swatch.type = 'color';

  swatch.className = 'settings-appearance-color-swatch';

  swatch.setAttribute('aria-label', `${labelForKey(key)} color`);



  const alphaWrap = el('div', 'settings-appearance-color-alpha');

  alphaWrap.appendChild(el('span', 'settings-appearance-color-alpha__label', 'A'));

  const alphaRange = document.createElement('input');

  alphaRange.type = 'range';

  alphaRange.className = 'settings-appearance-color-alpha__range';

  alphaRange.min = '0';

  alphaRange.max = '100';

  alphaRange.step = '1';

  alphaRange.setAttribute('aria-label', `${labelForKey(key)} opacity`);

  const alphaReadout = el('span', 'settings-appearance-color-alpha__readout', '100%');

  alphaWrap.append(alphaRange, alphaReadout);



  control.append(swatch, alphaWrap);

  field.appendChild(control);



  const valueReadout = el('span', 'settings-appearance-color-value');

  field.appendChild(valueReadout);



  function paintUi(): void {

    swatch.value = rgbaToColorInputValue(current);

    const alphaPct = Math.round(current.a * 100);

    alphaRange.value = String(alphaPct);

    alphaReadout.textContent = `${alphaPct}%`;

    valueReadout.textContent = formatCssColor(current);

  }



  function commit(): void {

    const css = formatCssColor(current);

    valueReadout.textContent = css;

    onChange(css);

  }



  swatch.addEventListener('input', () => {

    const parsed = parseCssColorOrDefault(swatch.value);

    current = { ...parsed, a: current.a };

    paintUi();

    commit();

  });



  alphaRange.addEventListener('input', () => {

    const pct = Number(alphaRange.value);

    current = { ...current, a: pct / 100 };

    paintUi();

    commit();

  });



  paintUi();



  return {

    root: field,

    getValue: () => formatCssColor(current),

    setValue: (css: string) => {

      current = parseCssColorOrDefault(css);

      paintUi();

    },

    setDisabled: (disabled: boolean) => {

      swatch.disabled = disabled;

      alphaRange.disabled = disabled;

      field.classList.toggle('is-disabled', disabled);

    },

  };

}



/** Mount custom color overrides, import/export, and contrast warnings. */

export function appendAppearanceCustomColors(mount: HTMLElement): void {

  const warningsMount = el('div', 'settings-appearance-warnings');



  const { row: enableRow, input: enableInput } = createSettingsToggleRow(

    'Use custom colors',

    { checked: isCustomThemeEnabled() },

  );

  mount.appendChild(enableRow);



  const grid = el('div', 'settings-appearance-color-grid');

  const controls = new Map<CoreThemeTokenKey, ColorTokenControl>();



  function refreshWarnings(): void {

    warningsMount.replaceChildren();

    const tokens: Record<string, string> = {};

    for (const key of CORE_THEME_TOKEN_KEYS) {

      const control = controls.get(key);

      tokens[key] = control?.getValue() || readEffectiveThemeTokens()[key];

    }

    for (const w of warnContrastPairs(tokens)) {

      const p = el(

        'p',

        'settings-field-hint settings-appearance-warn',

        `${w.pair}: contrast ${w.ratio.toFixed(2)} (minimum ${w.minimum})`,

      );

      warningsMount.appendChild(p);

    }

  }



  function syncInputsFromStorage(): void {

    const stored = getCustomThemeTokens();

    for (const key of CORE_THEME_TOKEN_KEYS) {

      const control = controls.get(key);

      if (!control) continue;

      const value = stored[key] ?? readPresetTokenValue(key);

      control.setValue(value);

      control.setDisabled(!enableInput.checked);

    }

    refreshWarnings();

  }



  for (const group of THEME_TOKEN_GROUPS) {

    const section = el('div', 'settings-appearance-color-group');

    section.appendChild(el('h4', 'settings-appearance-color-group__title', group.label));

    const fields = el('div', 'settings-appearance-color-fields');



    for (const key of group.keys) {

      const control = createColorTokenControl(key, (value) => {

        if (!enableInput.checked) return;

        setCustomThemeTokens({ [key]: value });

        refreshWarnings();

      });

      controls.set(key, control);

      fields.appendChild(control.root);

    }



    section.appendChild(fields);

    grid.appendChild(section);

  }



  mount.appendChild(grid);

  mount.appendChild(warningsMount);



  const actions = el('div', 'settings-actions');



  const forkBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Fork from preset');

  forkBtn.type = 'button';

  forkBtn.addEventListener('click', () => {

    applyResolvedTheme(getStoredTheme());

    const snapshot = readEffectiveThemeTokens();

    replaceCustomThemeTokens(snapshot);

    enableInput.checked = true;

    setCustomThemeEnabled(true);

    syncInputsFromStorage();

  });



  const resetBtn = el('button', 'settings-action-btn', 'Reset custom colors');

  resetBtn.type = 'button';

  resetBtn.addEventListener('click', () => {

    resetCustomTheme();

    enableInput.checked = false;

    applyResolvedTheme(getStoredTheme());

    syncInputsFromStorage();

  });



  const exportBtn = el('button', 'settings-action-btn', 'Export JSON');

  exportBtn.type = 'button';

  exportBtn.addEventListener('click', () => {

    const json = exportCustomThemeJson();

    try {

      downloadTextFile('minnow-theme.json', json, 'application/json');

      setStatus('ok', 'Theme exported as minnow-theme.json');

    } catch {

      void navigator.clipboard.writeText(json).then(

        () => setStatus('ok', 'Theme JSON copied to clipboard'),

        () => setStatus('err', 'Could not export theme'),

      );

    }

  });



  const importLabel = el('label', 'settings-action-btn settings-appearance-import');

  importLabel.textContent = 'Import JSON';

  const importInput = document.createElement('input');

  importInput.type = 'file';

  importInput.accept = 'application/json,.json';

  importInput.hidden = true;

  importInput.addEventListener('change', async () => {

    const file = importInput.files?.[0];

    importInput.value = '';

    if (!file) return;

    const text = await file.text();

    if (!importCustomThemeJson(text)) return;

    enableInput.checked = isCustomThemeEnabled();

    applyResolvedTheme(getStoredTheme());

    syncInputsFromStorage();

  });

  importLabel.appendChild(importInput);

  importLabel.addEventListener('click', () => importInput.click());



  actions.append(forkBtn, resetBtn, exportBtn, importLabel);

  mount.appendChild(actions);



  enableInput.addEventListener('change', () => {

    setCustomThemeEnabled(enableInput.checked);

    if (enableInput.checked) {

      const partial = getCustomThemeTokens();

      if (Object.keys(partial).length === 0) {

        replaceCustomThemeTokens(readEffectiveThemeTokens());

      } else {

        applyResolvedTheme(getStoredTheme());

      }

    } else {

      applyResolvedTheme(getStoredTheme());

    }

    syncInputsFromStorage();

  });



  syncInputsFromStorage();

}


