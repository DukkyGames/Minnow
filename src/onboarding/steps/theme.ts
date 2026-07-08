/**
 * S1 — Theme and accent: live preview on hover/selection.
 */

import {
  getFollowSystem,
  getStoredFamily,
  setFollowSystem,
  setThemeFamily,
  setThemeMode,
  THEME_FAMILY_META,
  type ThemeFamily,
  type ThemeMode,
} from '../../theme';
import { applyResolvedTheme } from '../../ui/theme';
import { saveDesktopPref, loadDesktopPrefs } from '../../os/desktop-prefs';
import { WALLPAPER_CATALOG, type WallpaperMode } from '../../os/wallpaper';
import { createChoiceCard, el } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

const THEME_MODES: { id: ThemeMode | 'system'; label: string; desc: string }[] = [
  { id: 'light', label: 'Light', desc: 'Bright rooms and daytime desks.' },
  { id: 'dark', label: 'Dark', desc: 'Dim rooms without changing layout.' },
  { id: 'system', label: 'System', desc: 'Follow your OS appearance.' },
];

const WALLPAPER_PICKS: WallpaperMode[] = ['underwater', 'minnow', 'flat', 'gradient'];

let selectedMode: ThemeMode | 'system' = 'light';
let selectedFamily: ThemeFamily = 'sage';
let selectedWallpaper: WallpaperMode = 'underwater';

function previewTheme(mode: ThemeMode | 'system', family: ThemeFamily): void {
  if (mode === 'system') {
    setFollowSystem(true);
    applyResolvedTheme();
    return;
  }
  setFollowSystem(false);
  setThemeFamily(family);
  setThemeMode(mode);
  applyResolvedTheme();
}

export const themeStep: OnboardingStep = {
  id: 'theme',
  title: 'Theme',
  canSkip: true,

  isApplicable() {
    return true;
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--theme';

    const prefs = loadDesktopPrefs();
    selectedFamily = ctx.themeFamily ?? getStoredFamily();
    selectedWallpaper = ctx.wallpaper ?? prefs.wallpaper ?? 'underwater';
    if (ctx.themeMode) {
      selectedMode = ctx.themeMode;
    } else if (getFollowSystem()) {
      selectedMode = 'system';
    } else {
      selectedMode = 'light';
    }

    container.appendChild(el('h2', 'mn-onboarding-step-title', 'Choose your look'));
    container.appendChild(
      el('p', 'mn-onboarding-step-desc', 'Theme applies live as you browse options.'),
    );

    const modeGrid = el('div', 'mn-onboarding-choice-grid mn-onboarding-choice-grid--3');
    THEME_MODES.forEach((mode) => {
      const card = createChoiceCard({
        title: mode.label,
        description: mode.desc,
        recommended: mode.id === 'light',
        selected: selectedMode === mode.id,
        onSelect: () => {
          selectedMode = mode.id;
          previewTheme(mode.id, selectedFamily);
          actions.patchContext({ themeMode: mode.id, themeFamily: selectedFamily });
          rerenderSelection(modeGrid, familyRow, wallpaperRow);
        },
        onHover: () => previewTheme(mode.id, selectedFamily),
      });
      card.dataset.mode = mode.id;
      modeGrid.appendChild(card);
    });
    container.appendChild(modeGrid);

    container.appendChild(el('h3', 'mn-onboarding-subtitle', 'Accent family'));
    const familyRow = el('div', 'mn-onboarding-swatch-row');
    THEME_FAMILY_META.forEach((meta) => {
      const swatch = el('button', 'mn-onboarding-swatch');
      swatch.type = 'button';
      swatch.title = meta.name;
      swatch.dataset.family = meta.id;
      if (meta.id === selectedFamily) swatch.classList.add('is-selected');
      swatch.addEventListener('click', () => {
        selectedFamily = meta.id;
        previewTheme(selectedMode, meta.id);
        actions.patchContext({ themeFamily: meta.id });
        rerenderSelection(modeGrid, familyRow, wallpaperRow);
      });
      familyRow.appendChild(swatch);
    });
    container.appendChild(familyRow);

    container.appendChild(el('h3', 'mn-onboarding-subtitle', 'Desktop wallpaper'));
    const wallpaperRow = el('div', 'mn-onboarding-wallpaper-row');
    WALLPAPER_PICKS.forEach((id) => {
      const meta = WALLPAPER_CATALOG.find((w) => w.id === id);
      const btn = el('button', 'mn-onboarding-wallpaper-chip', meta?.label ?? id);
      btn.type = 'button';
      btn.dataset.wallpaper = id;
      if (id === selectedWallpaper) btn.classList.add('is-selected');
      btn.addEventListener('click', () => {
        selectedWallpaper = id;
        saveDesktopPref('wallpaper', id);
        actions.patchContext({ wallpaper: id });
        rerenderSelection(modeGrid, familyRow, wallpaperRow);
      });
      wallpaperRow.appendChild(btn);
    });
    container.appendChild(wallpaperRow);

    const foot = el('p', 'mn-onboarding-footnote');
    foot.append('Change anytime in ');
    const link = el('button', 'mn-onboarding-settings-link', 'Settings → Appearance');
    link.type = 'button';
    link.dataset.settingsSearchKey = 'appearance.theme';
    foot.appendChild(link);
    container.appendChild(foot);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(true);
  },

  commit(ctx) {
    if (selectedMode === 'system') {
      setFollowSystem(true);
    } else {
      setFollowSystem(false);
      setThemeFamily(selectedFamily);
      setThemeMode(selectedMode);
    }
    applyResolvedTheme();
    saveDesktopPref('wallpaper', selectedWallpaper);
    ctx.state = recordStepProgress(ctx.state, 'theme', {
      done: true,
      data: {
        mode: selectedMode,
        family: selectedFamily,
        wallpaper: selectedWallpaper,
      },
    });
  },
};

function rerenderSelection(
  modeGrid: HTMLElement,
  familyRow: HTMLElement,
  wallpaperRow: HTMLElement,
): void {
  modeGrid.querySelectorAll('.mn-onboarding-choice').forEach((node) => {
    const card = node as HTMLElement;
    card.classList.toggle('is-selected', card.dataset.mode === selectedMode);
  });
  familyRow.querySelectorAll('.mn-onboarding-swatch').forEach((node) => {
    const sw = node as HTMLElement;
    sw.classList.toggle('is-selected', sw.dataset.family === selectedFamily);
  });
  wallpaperRow.querySelectorAll('.mn-onboarding-wallpaper-chip').forEach((node) => {
    const chip = node as HTMLElement;
    chip.classList.toggle('is-selected', chip.dataset.wallpaper === selectedWallpaper);
  });
}
