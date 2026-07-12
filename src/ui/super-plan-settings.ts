/**
 * Super Plan pipeline knobs (Settings → Modes → Super Plan).
 */

import {
  loadSuperPlanConfig,
  saveSuperPlanConfig,
  type SuperPlanImpeccableMode,
  type SuperPlanResearchDepth,
} from '../config/super-plan-meta';
import type { ResearchScope } from '../research/types';
import {
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';

function appendNumberField(
  container: HTMLElement,
  labelText: string,
  inputId: string,
  hint: string,
  min: number,
  max: number,
): HTMLInputElement {
  const field = document.createElement('div');
  field.className = 'settings-field';

  const label = document.createElement('label');
  label.className = 'settings-field-label';
  label.htmlFor = inputId;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'number';
  input.id = inputId;
  input.className = 'settings-input';
  input.min = String(min);
  input.max = String(max);

  const hintEl = document.createElement('p');
  hintEl.className = 'settings-field-hint';
  hintEl.textContent = hint;

  field.appendChild(label);
  field.appendChild(input);
  field.appendChild(hintEl);
  container.appendChild(field);
  return input;
}

function appendToggleField(
  container: HTMLElement,
  labelText: string,
  inputId: string,
  hint: string,
): HTMLInputElement {
  const field = document.createElement('div');
  field.className = 'settings-field';

  const label = document.createElement('label');
  label.className = 'settings-field-label settings-field-label--inline';
  label.htmlFor = inputId;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = inputId;
  input.className = 'settings-checkbox';

  label.appendChild(input);
  label.appendChild(document.createTextNode(` ${labelText}`));

  const hintEl = document.createElement('p');
  hintEl.className = 'settings-field-hint';
  hintEl.textContent = hint;

  field.appendChild(label);
  field.appendChild(hintEl);
  container.appendChild(field);
  return input;
}

function appendSelectField(
  container: HTMLElement,
  labelText: string,
  selectId: string,
  hint: string,
  options: { value: string; label: string }[],
): HTMLSelectElement {
  const field = document.createElement('div');
  field.className = 'settings-field';

  const label = document.createElement('label');
  label.className = 'settings-field-label';
  label.htmlFor = selectId;
  label.textContent = labelText;

  const select = document.createElement('select');
  select.id = selectId;
  select.className = 'settings-select';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }

  const hintEl = document.createElement('p');
  hintEl.className = 'settings-field-hint';
  hintEl.textContent = hint;

  field.appendChild(label);
  field.appendChild(select);
  field.appendChild(hintEl);
  container.appendChild(field);
  return select;
}

function appendModelSelectField(
  container: HTMLElement,
  labelText: string,
  selectId: string,
): HTMLSelectElement {
  const field = document.createElement('div');
  field.className = 'settings-field';

  const label = document.createElement('label');
  label.className = 'settings-field-label';
  label.htmlFor = selectId;
  label.textContent = labelText;

  const select = document.createElement('select');
  select.id = selectId;
  select.className = 'settings-select';

  field.appendChild(label);
  field.appendChild(select);
  container.appendChild(field);
  return select;
}

/** Mount Super Plan pipeline controls inside Settings → Modes → Super Plan. */
export function mountSuperPlanSettings(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.id = 'superPlanSettings';
  wrap.className = 'settings-super-plan';

  wrap.appendChild(
    Object.assign(document.createElement('p'), {
      className: 'settings-field-hint',
      textContent:
        'Pipeline defaults for Super Plan mode. The controller reads these when orchestrating grill → spec → research → draft/review → Impeccable → finalize.',
    }),
  );

  const grillEnabledInput = appendToggleField(
    wrap,
    'Grill interview stage',
    'superPlanGrillEnabled',
    'Uncheck to skip the clarifying-questions interview and go straight to the build spec.',
  );

  const researchEnabledInput = appendToggleField(
    wrap,
    'Deep Research stage',
    'superPlanResearchEnabled',
    'Uncheck to skip Deep Research and draft the plan from the build spec alone.',
  );

  const reviewRoundsInput = appendNumberField(
    wrap,
    'Review rounds',
    'superPlanReviewRounds',
    'Number of review cycles after Draft 1 (0 = draft only; default 2).',
    0,
    4,
  );

  const grillBudgetInput = appendNumberField(
    wrap,
    'Grill question budget',
    'superPlanGrillBudget',
    'Target number of clarifying questions in the grill stage (~20 default).',
    5,
    40,
  );

  const impeccableSelect = appendSelectField(
    wrap,
    'Impeccable stage',
    'superPlanImpeccable',
    'Auto runs Impeccable when UI is detected in spec/research/plan; Always forces it; Never skips.',
    [
      { value: 'auto', label: 'Auto when UI involved (default)' },
      { value: 'always', label: 'Always run Impeccable' },
      { value: 'never', label: 'Never run Impeccable' },
    ],
  );

  const researchScopeSelect = appendSelectField(
    wrap,
    'Research scope',
    'superPlanResearchScope',
    'Where Deep Research gathers evidence for the build spec.',
    [
      { value: 'both', label: 'Web + Codebase (default)' },
      { value: 'web', label: 'Web only' },
      { value: 'codebase', label: 'Codebase only' },
    ],
  );

  const researchRoundsSelect = appendSelectField(
    wrap,
    'Research rounds',
    'superPlanResearchRounds',
    'Explicit round cap (Auto uses depth preset or engine default).',
    [
      { value: '0', label: 'Auto (use depth preset)' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
      { value: '5', label: '5' },
    ],
  );

  const researchDepthSelect = appendSelectField(
    wrap,
    'Research depth',
    'superPlanResearchDepth',
    'When rounds is Auto: quick (2), standard (3), deep (5), or engine auto (8).',
    [
      { value: 'auto', label: 'Auto — engine default (default)' },
      { value: 'quick', label: 'Quick — 2 rounds' },
      { value: 'standard', label: 'Standard — 3 rounds' },
      { value: 'deep', label: 'Deep — 5 rounds' },
    ],
  );

  const modelsHeading = document.createElement('p');
  modelsHeading.className = 'settings-field-label';
  modelsHeading.textContent = 'Per-stage model overrides';
  wrap.appendChild(modelsHeading);

  const modelsHint = document.createElement('p');
  modelsHint.className = 'settings-field-hint';
  modelsHint.textContent = 'Empty selections inherit the chat default or sub-agent / research config.';
  wrap.appendChild(modelsHint);

  const researchProviderSelect = appendModelSelectField(
    wrap,
    'Research provider',
    'superPlanResearchProvider',
  );
  const researchModelSelect = appendModelSelectField(
    wrap,
    'Research model',
    'superPlanResearchModel',
  );
  const reviewerProviderSelect = appendModelSelectField(
    wrap,
    'Reviewer provider',
    'superPlanReviewerProvider',
  );
  const reviewerModelSelect = appendModelSelectField(
    wrap,
    'Reviewer model',
    'superPlanReviewerModel',
  );
  const plannerProviderSelect = appendModelSelectField(
    wrap,
    'Planner provider',
    'superPlanPlannerProvider',
  );
  const plannerModelSelect = appendModelSelectField(
    wrap,
    'Planner model',
    'superPlanPlannerModel',
  );

  container.appendChild(wrap);

  const persist = async (): Promise<void> => {
    await saveSuperPlanConfig({
      reviewRounds: Number(reviewRoundsInput.value),
      grillEnabled: grillEnabledInput.checked,
      researchEnabled: researchEnabledInput.checked,
      grillQuestionBudget: Number(grillBudgetInput.value),
      impeccable: impeccableSelect.value as SuperPlanImpeccableMode,
      researchScope: researchScopeSelect.value as ResearchScope,
      researchMaxRounds: Number(researchRoundsSelect.value),
      researchDepth: researchDepthSelect.value as SuperPlanResearchDepth,
      researchModel: {
        providerId: researchProviderSelect.value,
        modelId: researchModelSelect.value,
      },
      reviewerModel: {
        providerId: reviewerProviderSelect.value,
        modelId: reviewerModelSelect.value,
      },
      plannerModel: {
        providerId: plannerProviderSelect.value,
        modelId: plannerModelSelect.value,
      },
    });
  };

  grillEnabledInput.addEventListener('change', () => void persist());
  researchEnabledInput.addEventListener('change', () => void persist());
  reviewRoundsInput.addEventListener('change', () => void persist());
  grillBudgetInput.addEventListener('change', () => void persist());
  impeccableSelect.addEventListener('change', () => void persist());
  researchScopeSelect.addEventListener('change', () => void persist());
  researchRoundsSelect.addEventListener('change', () => void persist());
  researchDepthSelect.addEventListener('change', () => void persist());

  researchProviderSelect.addEventListener('change', () => {
    void fillModelSelect(researchModelSelect, researchProviderSelect.value, '').then(() =>
      persist(),
    );
  });
  researchModelSelect.addEventListener('change', () => void persist());
  reviewerProviderSelect.addEventListener('change', () => {
    void fillModelSelect(reviewerModelSelect, reviewerProviderSelect.value, '').then(() =>
      persist(),
    );
  });
  reviewerModelSelect.addEventListener('change', () => void persist());
  plannerProviderSelect.addEventListener('change', () => {
    void fillModelSelect(plannerModelSelect, plannerProviderSelect.value, '').then(() => persist());
  });
  plannerModelSelect.addEventListener('change', () => void persist());

  void (async () => {
    const config = await loadSuperPlanConfig();
    grillEnabledInput.checked = config.grillEnabled;
    researchEnabledInput.checked = config.researchEnabled;
    reviewRoundsInput.value = String(config.reviewRounds);
    grillBudgetInput.value = String(config.grillQuestionBudget);
    impeccableSelect.value = config.impeccable;
    researchScopeSelect.value = config.researchScope;
    researchRoundsSelect.value = String(config.researchMaxRounds);
    researchDepthSelect.value = config.researchDepth;

    await fillProviderSelect(researchProviderSelect, config.researchModel.providerId, {
      includeEmptyOption: true,
    });
    await fillModelSelect(
      researchModelSelect,
      researchProviderSelect.value,
      config.researchModel.modelId,
      { includeEmptyOption: true },
    );

    await fillProviderSelect(reviewerProviderSelect, config.reviewerModel.providerId, {
      includeEmptyOption: true,
    });
    await fillModelSelect(
      reviewerModelSelect,
      reviewerProviderSelect.value,
      config.reviewerModel.modelId,
      { includeEmptyOption: true },
    );

    await fillProviderSelect(plannerProviderSelect, config.plannerModel.providerId, {
      includeEmptyOption: true,
    });
    await fillModelSelect(
      plannerModelSelect,
      plannerProviderSelect.value,
      config.plannerModel.modelId,
      { includeEmptyOption: true },
    );
  })();
}
