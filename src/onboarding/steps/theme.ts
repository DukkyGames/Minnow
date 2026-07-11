/**
 * S1 — Theme and accent: reuses Settings → Appearance theme + wallpaper pickers.
 */

import '../../styles/settings-page.css';
import '../../styles/settings-appearance.css';

import { loadDesktopPrefs, saveDesktopPref } from '../../os/desktop-prefs';
import {
  getFollowSystem,
  getMode,
  getStoredFamily,
  getStoredTheme,
  setFollowSystem,
  setThemeFamily,
  setThemeMode,
  type ThemeMode,
} from '../../theme';
import { appendAppearanceWallpaper } from '../../ui/settings-appearance-wallpaper';
import { appendThemeControls } from '../../ui/settings-theme';
import { applyResolvedTheme } from '../../ui/theme';
import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

/** Apply wizard context onto live theme + wallpaper prefs before mounting shared controls. */
function syncContextToAppearance(ctx: OnboardingContext): void {
  const prefs = loadDesktopPrefs();

  if (ctx.wallpaper) {
    saveDesktopPref('wallpaper', ctx.wallpaper);
  } else if (prefs.wallpaper) {
    saveDesktopPref('wallpaper', prefs.wallpaper);
  }

  if (ctx.themeMode === 'system') {
    setFollowSystem(true);
  } else if (ctx.themeMode) {
    setFollowSystem(false);
    setThemeMode(ctx.themeMode);
  }

  if (ctx.themeFamily) {
    setThemeFamily(ctx.themeFamily);
  }

  applyResolvedTheme(getStoredTheme());
}

export const themeStep: OnboardingStep = {
  id: 'theme',
  title: 'Choose your look',
  canSkip: true,

  isApplicable() {
    return true;
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--theme';

    syncContextToAppearance(ctx);

    renderStepHeader(container, themeStep, actions.stepIndex, actions.totalSteps);
    container.appendChild(
      el('p', 'mn-onboarding-step-desc', 'Theme applies live as you browse options.'),
    );

    const themeMount = el('div', 'mn-onboarding-appearance-theme');
    appendThemeControls(themeMount, {
      onChange: (state) => {
        actions.patchContext({
          themeMode: state.followSystem ? 'system' : state.mode,
          themeFamily: state.family,
        });
      },
    });
    container.appendChild(themeMount);

    container.appendChild(el('h3', 'mn-onboarding-subtitle', 'Desktop wallpaper'));
    const wallpaperMount = el('div', 'mn-onboarding-appearance-wallpaper');
    appendAppearanceWallpaper(wallpaperMount, {
      hideCustomPanel: true,
      onChange: (wallpaper) => {
        actions.patchContext({ wallpaper });
      },
    });
    container.appendChild(wallpaperMount);

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
    applyResolvedTheme(getStoredTheme());

    const follow = getFollowSystem();
    const family = getStoredFamily();
    const mode: ThemeMode | 'system' = follow ? 'system' : getMode(getStoredTheme());
    const wallpaper = loadDesktopPrefs().wallpaper;

    ctx.state = recordStepProgress(ctx.state, 'theme', {
      done: true,
      data: {
        mode,
        family,
        wallpaper,
      },
    });
  },
};
