/**
 * Settings → Deep Research — dedicated model binding and engine parameters.
 */

import {
  DEFAULT_RESEARCH_CONFIG,
  loadResearchConfig,
  saveResearchConfig,
  type ResearchConfig,
} from '../config/research-config';
import type { SearchProvider } from '../config/search-config';
import {
  appendProviderModelFields,
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';
import { appendSettingsCrosslinks, appendSettingsGroup } from './settings-layout';
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

/** Append a labeled numeric field for research.json limits. */
function appendNumberField(
  container: HTMLElement,
  id: string,
  label: string,
  hint: string,
  options: { min: number; max: number; step?: number },
): HTMLInputElement {
  const field = el('div', 'settings-field');
  const labelEl = el('label', 'settings-field-label', label);
  labelEl.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.className = 'settings-input';
  input.min = String(options.min);
  input.max = String(options.max);
  if (options.step) input.step = String(options.step);
  field.append(labelEl, input, el('p', 'settings-field-hint', hint));
  container.appendChild(field);
  return input;
}

const SEARCH_OVERRIDE_OPTIONS: { value: SearchProvider | ''; label: string }[] = [
  { value: '', label: '(use Search section primary)' },
  { value: 'searxng', label: 'SearXNG' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'brave', label: 'Brave' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'disabled', label: 'Disabled' },
];

/** Render Settings → Deep Research into the section mount. */
export async function renderDeepResearchSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  const modelGroup = appendSettingsGroup(
    mount,
    'Research model',
    'Provider and model for plan, query, extraction, synthesis, and final report LLM calls.',
  );
  const { providerSelect, modelSelect } = appendProviderModelFields(
    modelGroup,
    { provider: 'settingsResearchProvider', model: 'settingsResearchModel' },
    { provider: 'Provider', model: 'Model' },
  );

  const searchOverrideGroup = appendSettingsGroup(
    mount,
    'Search override',
    'Optional primary provider override for research runs only.',
  );
  const overrideField = el('div', 'settings-field');
  const overrideLabel = el('label', 'settings-field-label', 'Research search provider');
  overrideLabel.htmlFor = 'settingsResearchSearchProvider';
  const overrideSelect = document.createElement('select');
  overrideSelect.id = 'settingsResearchSearchProvider';
  overrideSelect.className = 'settings-select';
  for (const opt of SEARCH_OVERRIDE_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    overrideSelect.appendChild(option);
  }
  overrideField.append(overrideLabel, overrideSelect);
  searchOverrideGroup.appendChild(overrideField);

  const scopeField = el('div', 'settings-field');
  const scopeLabel = el('label', 'settings-field-label', 'Default search scope');
  scopeLabel.htmlFor = 'settingsResearchSearchScope';
  const scopeSelect = document.createElement('select');
  scopeSelect.id = 'settingsResearchSearchScope';
  scopeSelect.className = 'settings-select';
  for (const opt of [
    { value: 'web', label: 'Web only' },
    { value: 'codebase', label: 'Codebase only' },
    { value: 'both', label: 'Web + codebase' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    scopeSelect.appendChild(option);
  }
  scopeField.append(
    scopeLabel,
    scopeSelect,
    el(
      'p',
      'settings-field-hint',
      'Default for new research runs. Super Plan and explicit API requests can override per run.',
    ),
  );
  searchOverrideGroup.appendChild(scopeField);

  const loopGroup = appendSettingsGroup(
    mount,
    'Research loop',
    'Round caps and wall-clock limits for the iterative engine.',
  );
  const maxRounds = appendNumberField(
    loopGroup,
    'settingsResearchMaxRounds',
    'Max rounds',
    '0 = Auto (engine decides), hard cap 20.',
    { min: 0, max: 20, step: 1 },
  );
  const minRounds = appendNumberField(
    loopGroup,
    'settingsResearchMinRounds',
    'Min rounds before stop question',
    'Stop decision is only asked after this many rounds (default 3).',
    { min: 1, max: 20, step: 1 },
  );
  const maxTime = appendNumberField(
    loopGroup,
    'settingsResearchMaxTimeSeconds',
    'Max time per loop (seconds)',
    'Wall clock for one research loop iteration.',
    { min: 30, max: 3600, step: 30 },
  );
  const runTimeout = appendNumberField(
    loopGroup,
    'settingsResearchRunTimeoutSeconds',
    'Run timeout (seconds)',
    'Hard wall clock for the full run; 0 = unlimited.',
    { min: 0, max: 86400, step: 60 },
  );
  const maxEmpty = appendNumberField(
    loopGroup,
    'settingsResearchMaxEmptyRounds',
    'Max empty rounds',
    'Consecutive rounds with no new findings before giving up.',
    { min: 1, max: 10, step: 1 },
  );

  const extractGroup = appendSettingsGroup(
    mount,
    'Extraction & synthesis',
    'Per-page fetch limits and concurrent extraction.',
  );
  const extractTimeout = appendNumberField(
    extractGroup,
    'settingsResearchExtractionTimeout',
    'Extraction timeout (seconds)',
    'Timeout for a single page extraction LLM call.',
    { min: 10, max: 600, step: 5 },
  );
  const extractConcurrency = appendNumberField(
    extractGroup,
    'settingsResearchExtractionConcurrency',
    'Extraction concurrency',
    'Max parallel page extractions per round.',
    { min: 1, max: 20, step: 1 },
  );
  const maxUrls = appendNumberField(
    extractGroup,
    'settingsResearchMaxUrlsPerRound',
    'Max URLs per round',
    'New URLs to fetch each research round.',
    { min: 1, max: 20, step: 1 },
  );
  const maxContent = appendNumberField(
    extractGroup,
    'settingsResearchMaxContentChars',
    'Max content chars per page',
    'Truncation limit before extraction prompt.',
    { min: 1000, max: 100000, step: 500 },
  );
  const synthesisWindow = appendNumberField(
    extractGroup,
    'settingsResearchSynthesisWindow',
    'Synthesis window',
    'Number of recent findings merged per synthesize step.',
    { min: 1, max: 50, step: 1 },
  );

  const reportGroup = appendSettingsGroup(
    mount,
    'Final report',
    'Token budget for the final report generation call.',
  );
  const maxReportTokens = appendNumberField(
    reportGroup,
    'settingsResearchMaxReportTokens',
    'Max report tokens',
    'Upper bound for final report completion tokens.',
    { min: 1024, max: 131072, step: 256 },
  );

  const saveBtn = el('button', 'settings-action-btn', 'Save Deep Research settings');
  saveBtn.type = 'button';
  mount.appendChild(saveBtn);

  let current: ResearchConfig = { ...DEFAULT_RESEARCH_CONFIG };
  try {
    current = await loadResearchConfig();
  } catch {
    setStatus('err', 'Could not load research settings — use npm start');
  }

  await fillProviderSelect(providerSelect, current.model.providerId, {
    includeEmptyOption: true,
  });
  await fillModelSelect(modelSelect, current.model.providerId, current.model.model);

  providerSelect.addEventListener('change', () => {
    void fillModelSelect(modelSelect, providerSelect.value, modelSelect.value);
  });

  const applyToForm = (config: ResearchConfig): void => {
    providerSelect.value = config.model.providerId || '';
    modelSelect.value = config.model.model || '';
    overrideSelect.value = config.searchProvider || '';
    scopeSelect.value = config.searchScope || 'web';
    maxRounds.value = String(config.maxRounds);
    minRounds.value = String(config.minRounds);
    maxTime.value = String(config.maxTimeSeconds);
    runTimeout.value = String(config.runTimeoutSeconds);
    maxEmpty.value = String(config.maxEmptyRounds);
    extractTimeout.value = String(config.extractionTimeoutSeconds);
    extractConcurrency.value = String(config.extractionConcurrency);
    maxUrls.value = String(config.maxUrlsPerRound);
    maxContent.value = String(config.maxContentChars);
    synthesisWindow.value = String(config.synthesisWindow);
    maxReportTokens.value = String(config.maxReportTokens);
  };
  applyToForm(current);

  const readForm = (): ResearchConfig => ({
    model: {
      providerId: providerSelect.value.trim(),
      model: modelSelect.value.trim(),
    },
    searchProvider: (overrideSelect.value || '') as ResearchConfig['searchProvider'],
    searchScope: (scopeSelect.value || 'web') as ResearchConfig['searchScope'],
    maxRounds: Number(maxRounds.value),
    minRounds: Number(minRounds.value),
    maxTimeSeconds: Number(maxTime.value),
    runTimeoutSeconds: Number(runTimeout.value),
    maxEmptyRounds: Number(maxEmpty.value),
    extractionTimeoutSeconds: Number(extractTimeout.value),
    extractionConcurrency: Number(extractConcurrency.value),
    maxUrlsPerRound: Number(maxUrls.value),
    maxContentChars: Number(maxContent.value),
    synthesisWindow: Number(synthesisWindow.value),
    maxReportTokens: Number(maxReportTokens.value),
  });

  saveBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const saved = await saveResearchConfig(readForm());
        applyToForm(saved);
        if (saved.model.providerId) {
          await fillModelSelect(
            modelSelect,
            saved.model.providerId,
            saved.model.model,
          );
        }
        setStatus('ok', 'Deep Research settings saved');
      } catch {
        setStatus('err', 'Could not save research settings — use npm start');
      }
    })();
  });

  appendSettingsCrosslinks(mount, [
    { label: 'Search providers & keys', sectionId: 'search' },
    { label: 'Chat model bindings', sectionId: 'model-routing' },
  ]);
}
