/**
 * Choose your apps — pick which optional MinnowOS apps appear in the dock.
 */

import '../../styles/app-picker.css';

import {
  listCoreReleasedApps,
  listOptionalReleasedApps,
} from '../../os/app-registry';
import {
  isAppEnabled,
  listEnabledOptionalAppIds,
  setEnabledOptionalApps,
} from '../../os/app-preferences';
import { appendAppPickerGroup } from '../../os/app-picker-ui';
import { el, renderStepHeader, settingsLink } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';
import type { AppId } from '../../os/types';

/** Working selection for optional apps (defaults from current preferences). */
let selectedOptional = new Set<AppId>();

function syncSelectionFromPrefs(): void {
  selectedOptional = new Set(listEnabledOptionalAppIds());
}

export const appsStep: OnboardingStep = {
  id: 'apps',
  title: 'Choose your apps',
  canSkip: true,

  isApplicable() {
    return true;
  },

  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--apps';

    // Resume from live preferences so reruns reflect the current dock.
    syncSelectionFromPrefs();

    renderStepHeader(container, appsStep, actions.stepIndex, actions.totalSteps);
    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Pick the apps you want in the dock. You can change this anytime in Settings.',
      ),
    );

    appendAppPickerGroup(container, {
      title: 'Always included',
      description: 'These stay available. They cannot be turned off.',
      apps: listCoreReleasedApps(),
      mode: 'always-on',
      isSelected: () => true,
    });

    appendAppPickerGroup(container, {
      title: 'Optional apps',
      description: 'Selected apps appear in the dock and launchers.',
      apps: listOptionalReleasedApps(),
      mode: 'selectable',
      isSelected: (id) => selectedOptional.has(id),
      onToggle: (id, selected) => {
        if (selected) selectedOptional.add(id);
        else selectedOptional.delete(id);
      },
    });

    const foot = el('p', 'mn-onboarding-footnote');
    foot.append('Change anytime in ');
    foot.appendChild(settingsLink('Settings → Apps', 'apps.visibility'));
    container.appendChild(foot);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(true);
  },

  commit(ctx) {
    // Continue persists the in-memory selection (seeded from prefs on render).
    // Skip does not call commit, so defaults / current prefs stay unchanged.
    const enabled = [...selectedOptional];
    setEnabledOptionalApps(enabled);

    ctx.state = recordStepProgress(ctx.state, 'apps', {
      done: true,
      data: {
        enabledAppIds: enabled,
        coreAppIds: listCoreReleasedApps().map((app) => app.id),
      },
    });
  },
};

/** Reset step selection cache (tests). */
export function resetAppsStepState(): void {
  selectedOptional = new Set(
    listOptionalReleasedApps()
      .map((app) => app.id)
      .filter((id) => isAppEnabled(id)),
  );
}
