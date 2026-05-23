/**
 * Settings → General: palette family picker, mode pills, follow-system toggle.
 */

import {
  getFollowSystem,
  getMode,
  getStoredFamily,
  getStoredTheme,
  setFollowSystem,
  setThemeFamily,
  setThemeMode,
  THEME_FAMILY_META,
  type ThemeFamily,
  type ThemeMode,
} from '../theme';
import { applyResolvedTheme } from './theme';

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

const CHECK_SVG =
  '<svg class="settings-theme-check" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 11.2 3.4 8.4l-1 1 3.8 3.8 7.8-7.8-1-1z"/></svg>';

/** Mount theme family list, mode pills, and follow-system control. */
export function appendThemeControls(mount: HTMLElement): void {
  const block = el('div', 'settings-theme-block');
  block.appendChild(el('p', 'settings-field-label', 'Theme'));
  block.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Four palette families, each with dark and light. Preview chips use live CSS tokens.',
    ),
  );

  const followRow = el('label', 'settings-theme-follow');
  const followInput = document.createElement('input');
  followInput.type = 'checkbox';
  followInput.checked = getFollowSystem();
  followRow.appendChild(followInput);
  followRow.appendChild(document.createTextNode('Follow system appearance'));
  block.appendChild(followRow);

  const modeRow = el('div', 'settings-theme-modes');
  modeRow.setAttribute('role', 'group');
  modeRow.setAttribute('aria-label', 'Color mode');
  const modeButtons: HTMLButtonElement[] = [];

  const familyList = el('div', 'settings-theme-families');
  familyList.setAttribute('role', 'list');
  const familyButtons: HTMLButtonElement[] = [];

  const currentId = getStoredTheme();
  const currentFamily = getFollowSystem() ? getStoredFamily() : currentId.split('-')[0];
  const currentMode = getMode(currentId);

  function refreshChrome(): void {
    const follow = getFollowSystem();
    const fam = getStoredFamily();
    const mode = getMode(getStoredTheme());
    modeRow.classList.toggle('is-system', follow);
    for (const btn of modeButtons) {
      const m = btn.dataset.mode as ThemeMode;
      btn.classList.toggle('is-active', !follow && m === mode);
      btn.setAttribute('aria-pressed', String(!follow && m === mode));
      btn.disabled = follow;
    }
    for (const btn of familyButtons) {
      const f = btn.dataset.family as ThemeFamily;
      btn.classList.toggle('is-active', f === fam);
      btn.setAttribute('aria-pressed', String(f === fam));
      const preview = btn.querySelector('.settings-theme-preview');
      if (preview instanceof HTMLElement) {
        preview.setAttribute('data-theme', `${f}-${mode}`);
      }
    }
  }

  for (const meta of THEME_FAMILY_META) {
    const item = el('button', 'settings-theme-family');
    item.type = 'button';
    item.dataset.family = meta.id;
    item.setAttribute('role', 'listitem');

    const head = el('div', 'settings-theme-family__head');
    head.appendChild(el('span', 'settings-theme-family__name', meta.name));
    head.appendChild(el('span', 'settings-theme-family__blurb', meta.blurb));
    item.appendChild(head);

    const preview = el('div', 'settings-theme-preview');
    preview.setAttribute('data-theme', `${meta.id}-${currentMode}`);
    const chipKeys = [
      ['--mn-bg', 'bg'],
      ['--mn-surface-1', 's1'],
      ['--mn-surface-2', 's2'],
      ['--mn-accent', 'accent'],
      ['--mn-accent-soft', 'soft'],
    ] as const;
    for (const [token, cls] of chipKeys) {
      const chip = el('span', `settings-theme-chip settings-theme-chip--${cls}`);
      chip.style.background = `var(${token})`;
      preview.appendChild(chip);
    }
    item.appendChild(preview);
    item.insertAdjacentHTML('beforeend', CHECK_SVG);

    item.addEventListener('click', () => {
      setThemeFamily(meta.id);
      applyResolvedTheme(getStoredTheme());
      refreshChrome();
    });

    familyButtons.push(item);
    familyList.appendChild(item);
  }

  for (const mode of ['dark', 'light'] as const) {
    const btn = el('button', 'settings-theme-mode');
    btn.type = 'button';
    btn.dataset.mode = mode;
    btn.textContent = mode === 'dark' ? 'Dark' : 'Light';
    btn.setAttribute('aria-pressed', String(!getFollowSystem() && mode === currentMode));
    if (!getFollowSystem() && mode === currentMode) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      if (getFollowSystem()) return;
      setThemeMode(mode);
      applyResolvedTheme(getStoredTheme());
      refreshChrome();
    });
    modeButtons.push(btn);
    modeRow.appendChild(btn);
  }

  followInput.addEventListener('change', () => {
    setFollowSystem(followInput.checked);
    applyResolvedTheme(getStoredTheme());
    refreshChrome();
  });

  block.appendChild(familyList);
  block.appendChild(modeRow);
  mount.appendChild(block);
  refreshChrome();
}
