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
  isCustomThemeAdvanced,
  isCustomThemeEnabled,
  readEffectiveThemeTokens,
  readPresetTokenValue,
  replaceCustomThemeTokens,
  resetCustomTheme,
  setCustomThemeAdvanced,
  setCustomThemeEnabled,
  setCustomThemeTokens,
} from '../appearance/custom-theme';
import { warnContrastPairs } from '../appearance/contrast';
import {
  deriveThemeTokensFromSeeds,
  extractSimplifiedSeeds,
  labelForSimplifiedKey,
  SIMPLIFIED_THEME_KEYS,
  type SimplifiedThemeKey,
} from '../appearance/theme-derive';
import {
  CORE_THEME_TOKEN_KEYS,
  THEME_TOKEN_GROUPS,
  type CoreThemeTokenKey,
} from '../appearance/types';
import { applyResolvedTheme } from './theme';
import { getStoredTheme } from '../theme';
import { createSettingsToggleRow } from './settings-switch';

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

interface ColorControlOptions {
  label: string;
  showAlpha?: boolean;
}

/** One token row: native color swatch, optional alpha slider, and formatted CSS readout. */
function createColorTokenControl(
  options: ColorControlOptions,
  onChange: (value: string) => void,
): ColorTokenControl {
  const showAlpha = options.showAlpha !== false;
  let current = parseCssColorOrDefault('');

  const field = el('label', 'settings-appearance-color-field');
  field.appendChild(el('span', 'settings-appearance-color-field__label', options.label));

  const control = el('div', 'settings-appearance-color-control');

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'settings-appearance-color-swatch';
  swatch.setAttribute('aria-label', `${options.label} color`);

  const alphaWrap = el('div', 'settings-appearance-color-alpha');
  alphaWrap.appendChild(el('span', 'settings-appearance-color-alpha__label', 'A'));
  const alphaRange = document.createElement('input');
  alphaRange.type = 'range';
  alphaRange.className = 'settings-appearance-color-alpha__range';
  alphaRange.min = '0';
  alphaRange.max = '100';
  alphaRange.step = '1';
  alphaRange.setAttribute('aria-label', `${options.label} opacity`);
  const alphaReadout = el('span', 'settings-appearance-color-alpha__readout', '100%');
  alphaWrap.append(alphaRange, alphaReadout);

  if (showAlpha) {
    control.append(swatch, alphaWrap);
  } else {
    control.appendChild(swatch);
  }
  field.appendChild(control);

  const valueReadout = el('span', 'settings-appearance-color-value');
  field.appendChild(valueReadout);

  function paintUi(): void {
    swatch.value = rgbaToColorInputValue(current);
    if (showAlpha) {
      const alphaPct = Math.round(current.a * 100);
      alphaRange.value = String(alphaPct);
      alphaReadout.textContent = `${alphaPct}%`;
    }
    valueReadout.textContent = formatCssColor(current);
  }

  function commit(): void {
    const css = formatCssColor(current);
    valueReadout.textContent = css;
    onChange(css);
  }

  swatch.addEventListener('input', () => {
    const parsed = parseCssColorOrDefault(swatch.value);
    current = { ...parsed, a: showAlpha ? current.a : 1 };
    paintUi();
    commit();
  });

  if (showAlpha) {
    alphaRange.addEventListener('input', () => {
      const pct = Number(alphaRange.value);
      current = { ...current, a: pct / 100 };
      paintUi();
      commit();
    });
  }

  paintUi();

  return {
    root: field,
    getValue: () => formatCssColor(current),
    setValue: (css: string) => {
      current = parseCssColorOrDefault(css);
      if (!showAlpha) current = { ...current, a: 1 };
      paintUi();
    },
    setDisabled: (disabled: boolean) => {
      swatch.disabled = disabled;
      if (showAlpha) alphaRange.disabled = disabled;
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

  const { row: advancedRow, input: advancedInput } = createSettingsToggleRow(
    'Advanced mode',
    {
      checked: isCustomThemeAdvanced(),
      description: 'Edit every palette token individually. Turning this off regenerates colors from the four simplified picks.',
    },
  );
  mount.appendChild(advancedRow);

  const simplifiedIntro = el(
    'p',
    'settings-field-hint settings-appearance-simplified__hint',
    'Pick four colors — Minnow generates surfaces, borders, semantic states, and accents automatically.',
  );

  const simplifiedGrid = el('div', 'settings-appearance-simplified');
  const simplifiedControls = new Map<SimplifiedThemeKey, ColorTokenControl>();

  const advancedGrid = el('div', 'settings-appearance-color-grid');
  const advancedControls = new Map<CoreThemeTokenKey, ColorTokenControl>();

  function readTokenSnapshot(): Record<CoreThemeTokenKey, string> {
    const tokens = {} as Record<CoreThemeTokenKey, string>;
    for (const key of CORE_THEME_TOKEN_KEYS) {
      const control = advancedControls.get(key);
      tokens[key] = control?.getValue() || readEffectiveThemeTokens()[key];
    }
    return tokens;
  }

  function refreshWarnings(): void {
    warningsMount.replaceChildren();
    const tokens = readTokenSnapshot();
    for (const w of warnContrastPairs(tokens)) {
      const p = el(
        'p',
        'settings-field-hint settings-appearance-warn',
        `${w.pair}: contrast ${w.ratio.toFixed(2)} (minimum ${w.minimum})`,
      );
      warningsMount.appendChild(p);
    }
  }

  function applyDerivedFromSimplified(): void {
    const seeds = extractSimplifiedSeeds(
      Object.fromEntries(
        SIMPLIFIED_THEME_KEYS.map((key) => [key, simplifiedControls.get(key)?.getValue() ?? '']),
      ),
      readEffectiveThemeTokens(),
    );
    const derived = deriveThemeTokensFromSeeds(seeds);
    replaceCustomThemeTokens(derived);
    for (const key of CORE_THEME_TOKEN_KEYS) {
      advancedControls.get(key)?.setValue(derived[key]);
    }
    refreshWarnings();
  }

  function syncSimplifiedFromTokens(tokens: Partial<Record<CoreThemeTokenKey, string>>): void {
    const seeds = extractSimplifiedSeeds(tokens, readEffectiveThemeTokens());
    for (const key of SIMPLIFIED_THEME_KEYS) {
      simplifiedControls.get(key)?.setValue(seeds[key]);
    }
  }

  function setEditorDisabled(disabled: boolean): void {
    for (const control of simplifiedControls.values()) control.setDisabled(disabled);
    for (const control of advancedControls.values()) control.setDisabled(disabled);
    advancedInput.disabled = disabled;
  }

  function updateEditorVisibility(): void {
    const advanced = advancedInput.checked;
    simplifiedIntro.hidden = advanced;
    simplifiedGrid.hidden = advanced;
    advancedGrid.hidden = !advanced;
  }

  function syncInputsFromStorage(): void {
    const stored = getCustomThemeTokens();
    const effective = readEffectiveThemeTokens();

    for (const key of CORE_THEME_TOKEN_KEYS) {
      const control = advancedControls.get(key);
      if (!control) continue;
      const value = stored[key] ?? effective[key] ?? readPresetTokenValue(key);
      control.setValue(value);
    }

    syncSimplifiedFromTokens(
      Object.keys(stored).length > 0 ? { ...effective, ...stored } : effective,
    );

    const disabled = !enableInput.checked;
    setEditorDisabled(disabled);
    advancedRow.classList.toggle('is-disabled', disabled);
    updateEditorVisibility();
    refreshWarnings();
  }

  for (const key of SIMPLIFIED_THEME_KEYS) {
    const control = createColorTokenControl(
      { label: labelForSimplifiedKey(key), showAlpha: false },
      () => {
        if (!enableInput.checked || advancedInput.checked) return;
        applyDerivedFromSimplified();
      },
    );
    simplifiedControls.set(key, control);
    simplifiedGrid.appendChild(control.root);
  }

  for (const group of THEME_TOKEN_GROUPS) {
    const section = el('div', 'settings-appearance-color-group');
    section.appendChild(el('h4', 'settings-appearance-color-group__title', group.label));
    const fields = el('div', 'settings-appearance-color-fields');

    for (const key of group.keys) {
      const control = createColorTokenControl({ label: labelForKey(key) }, (value) => {
        if (!enableInput.checked || !advancedInput.checked) return;
        setCustomThemeTokens({ [key]: value });
        refreshWarnings();
      });
      advancedControls.set(key, control);
      fields.appendChild(control.root);
    }

    section.appendChild(fields);
    advancedGrid.appendChild(section);
  }

  mount.append(simplifiedIntro, simplifiedGrid, advancedGrid, warningsMount);

  const actions = el('div', 'settings-actions');

  const forkBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Fork from preset');
  forkBtn.type = 'button';
  forkBtn.addEventListener('click', () => {
    applyResolvedTheme(getStoredTheme());
    const snapshot = readEffectiveThemeTokens();
    if (advancedInput.checked) {
      replaceCustomThemeTokens(snapshot);
    } else {
      syncSimplifiedFromTokens(snapshot);
      applyDerivedFromSimplified();
    }
    enableInput.checked = true;
    setCustomThemeEnabled(true);
    syncInputsFromStorage();
  });

  const resetBtn = el('button', 'settings-action-btn', 'Reset custom colors');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    resetCustomTheme();
    enableInput.checked = false;
    advancedInput.checked = false;
    applyResolvedTheme(getStoredTheme());
    syncInputsFromStorage();
  });

  const exportBtn = el('button', 'settings-action-btn', 'Export JSON');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', async () => {
    const json = exportCustomThemeJson();
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'minnow-theme.json';
      a.click();
      URL.revokeObjectURL(url);
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
    advancedInput.checked = isCustomThemeAdvanced();
    applyResolvedTheme(getStoredTheme());
    syncInputsFromStorage();
  });
  importLabel.appendChild(importInput);
  importLabel.addEventListener('click', () => importInput.click());

  actions.append(forkBtn, resetBtn, exportBtn, importLabel);
  mount.appendChild(actions);

  advancedInput.addEventListener('change', () => {
    setCustomThemeAdvanced(advancedInput.checked);
    if (!enableInput.checked) {
      updateEditorVisibility();
      return;
    }
    if (advancedInput.checked) {
      updateEditorVisibility();
      refreshWarnings();
      return;
    }
    applyDerivedFromSimplified();
    updateEditorVisibility();
  });

  enableInput.addEventListener('change', () => {
    setCustomThemeEnabled(enableInput.checked);
    if (enableInput.checked) {
      const partial = getCustomThemeTokens();
      if (Object.keys(partial).length === 0) {
        applyResolvedTheme(getStoredTheme());
        const snapshot = readEffectiveThemeTokens();
        if (advancedInput.checked) {
          replaceCustomThemeTokens(snapshot);
        } else {
          syncSimplifiedFromTokens(snapshot);
          applyDerivedFromSimplified();
        }
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
