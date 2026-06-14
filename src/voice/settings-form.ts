/**
 * Capability-gated STT settings form for Models → Voice.
 */

import type {
  VoiceConfig,
  VoiceSttLocalConfig,
  VoiceTtsLocalConfig,
} from '../config/voice-meta';
import type { SttCatalogEntry } from './catalog-stt';
import type { TtsCatalogEntry } from './catalog-tts';

type FieldGroup = 'basic' | 'advanced';

interface FieldSpec {
  key: keyof VoiceSttLocalConfig;
  label: string;
  group: FieldGroup;
  type: 'text' | 'number' | 'select' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  showWhen?: (config: VoiceSttLocalConfig, catalog?: SttCatalogEntry) => boolean;
}

const BASIC_FIELDS: FieldSpec[] = [
  {
    key: 'modelId',
    label: 'Model',
    group: 'basic',
    type: 'text',
    hint: 'HuggingFace model id (set via catalog download)',
  },
  {
    key: 'language',
    label: 'Language',
    group: 'basic',
    type: 'text',
    hint: 'ISO code or empty for auto-detect',
  },
  {
    key: 'task',
    label: 'Task',
    group: 'basic',
    type: 'select',
    options: [
      { value: 'transcribe', label: 'Transcribe' },
      { value: 'translate', label: 'Translate to English' },
    ],
    showWhen: (_c, catalog) => catalog?.capabilities.translate !== false,
  },
  {
    key: 'device',
    label: 'Device',
    group: 'basic',
    type: 'select',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'cuda', label: 'CUDA GPU' },
      { value: 'cpu', label: 'CPU' },
    ],
  },
  {
    key: 'computeType',
    label: 'Compute type',
    group: 'basic',
    type: 'select',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'float16', label: 'float16' },
      { value: 'bfloat16', label: 'bfloat16' },
      { value: 'float32', label: 'float32' },
    ],
  },
  {
    key: 'chunkLengthSeconds',
    label: 'Chunk length (s)',
    group: 'basic',
    type: 'number',
    min: 10,
    max: 30,
    step: 1,
    showWhen: (_c, catalog) => catalog?.capabilities.longForm !== false,
  },
  {
    key: 'batchSize',
    label: 'Batch size',
    group: 'basic',
    type: 'number',
    min: 1,
    max: 16,
    step: 1,
  },
];

const ADVANCED_FIELDS: FieldSpec[] = [
  {
    key: 'longFormAlgorithm',
    label: 'Long-form algorithm',
    group: 'advanced',
    type: 'select',
    options: [
      { value: 'chunked', label: 'Chunked' },
      { value: 'sequential', label: 'Sequential' },
    ],
    showWhen: (_c, catalog) => catalog?.capabilities.longForm !== false,
  },
  {
    key: 'returnTimestamps',
    label: 'Return timestamps',
    group: 'advanced',
    type: 'checkbox',
    showWhen: (_c, catalog) => catalog?.capabilities.timestamps !== false,
  },
  {
    key: 'timestampGranularity',
    label: 'Timestamp granularity',
    group: 'advanced',
    type: 'select',
    options: [
      { value: 'segment', label: 'Segment' },
      { value: 'word', label: 'Word' },
    ],
    showWhen: (c) => c.returnTimestamps,
  },
  {
    key: 'maxNewTokens',
    label: 'Max new tokens',
    group: 'advanced',
    type: 'number',
    min: 1,
    max: 448,
    step: 1,
  },
  {
    key: 'numBeams',
    label: 'Beam search width',
    group: 'advanced',
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
  },
  {
    key: 'conditionOnPrevTokens',
    label: 'Condition on previous tokens',
    group: 'advanced',
    type: 'checkbox',
  },
  {
    key: 'compressionRatioThreshold',
    label: 'Compression ratio threshold',
    group: 'advanced',
    type: 'number',
    min: 0.5,
    max: 2,
    step: 0.05,
  },
  {
    key: 'temperatureFallback',
    label: 'Temperature fallback',
    group: 'advanced',
    type: 'checkbox',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    group: 'advanced',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'logprobThreshold',
    label: 'Logprob threshold',
    group: 'advanced',
    type: 'number',
    min: -2,
    max: 0,
    step: 0.1,
  },
  {
    key: 'noSpeechThreshold',
    label: 'No-speech threshold',
    group: 'advanced',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'attnImplementation',
    label: 'Attention',
    group: 'advanced',
    type: 'select',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'sdpa', label: 'SDPA' },
      { value: 'flash_attention_2', label: 'Flash Attention 2' },
    ],
    showWhen: (_c, catalog) => catalog?.capabilities.flashAttention === true,
  },
  {
    key: 'useSafetensors',
    label: 'Use safetensors',
    group: 'advanced',
    type: 'checkbox',
  },
  {
    key: 'lowCpuMemUsage',
    label: 'Low CPU memory usage',
    group: 'advanced',
    type: 'checkbox',
  },
  {
    key: 'torchCompile',
    label: 'Torch compile',
    group: 'advanced',
    type: 'checkbox',
  },
];

function fieldId(key: string): string {
  return `voiceSttLocal_${key}`;
}

function renderField(
  spec: FieldSpec,
  config: VoiceSttLocalConfig,
  catalog: SttCatalogEntry | undefined,
  mount: HTMLElement,
): void {
  if (spec.showWhen && !spec.showWhen(config, catalog)) return;

  const wrap = document.createElement('div');
  wrap.className = 'models-voice-field';

  const label = document.createElement('label');
  label.className = 'models-voice-field__label';
  label.htmlFor = fieldId(spec.key);
  label.textContent = spec.label;
  wrap.appendChild(label);

  const value = config[spec.key];
  let control: HTMLInputElement | HTMLSelectElement;

  if (spec.type === 'checkbox') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(value);
    control = checkbox;
  } else if (spec.type === 'select') {
    const select = document.createElement('select');
    select.className = 'models-voice-field__input';
    for (const opt of spec.options ?? []) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (String(value) === opt.value) option.selected = true;
      select.appendChild(option);
    }
    control = select;
  } else {
    const textInput = document.createElement('input');
    textInput.className = 'models-voice-field__input';
    textInput.type = spec.type;
    if (spec.type === 'number') {
      if (spec.min != null) textInput.min = String(spec.min);
      if (spec.max != null) textInput.max = String(spec.max);
      if (spec.step != null) textInput.step = String(spec.step);
    }
    textInput.value = String(value ?? '');
    if (spec.key === 'modelId') {
      textInput.readOnly = true;
    }
    control = textInput;
  }

  control.id = fieldId(spec.key);
  control.dataset.voiceSttKey = spec.key;
  wrap.appendChild(control);

  if (spec.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = spec.hint;
    wrap.appendChild(hint);
  }

  mount.appendChild(wrap);
}

/** Read STT local config from rendered form controls. */
export function readSttLocalFromForm(base: VoiceSttLocalConfig): VoiceSttLocalConfig {
  const out = { ...base };
  const fields = [...BASIC_FIELDS, ...ADVANCED_FIELDS];
  for (const spec of fields) {
    const el = document.getElementById(fieldId(spec.key)) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!el) continue;
    if (spec.type === 'checkbox') {
      (out as Record<string, unknown>)[spec.key] = (el as HTMLInputElement).checked;
    } else if (spec.type === 'number') {
      const n = Number((el as HTMLInputElement).value);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[spec.key] = n;
    } else {
      (out as Record<string, unknown>)[spec.key] = el.value;
    }
  }
  return out;
}

export interface RenderSttSettingsFormOptions {
  mount: HTMLElement;
  config: VoiceConfig;
  catalogEntry?: SttCatalogEntry;
  onBackendChange?: (backend: 'local' | 'provider') => void;
}

/** Render backend toggle + capability-gated STT settings groups. */
export function renderSttSettingsForm(options: RenderSttSettingsFormOptions): void {
  const { mount, config, catalogEntry, onBackendChange } = options;
  mount.replaceChildren();

  const backendRow = document.createElement('div');
  backendRow.className = 'models-voice-backend-toggle';
  const backendLabel = document.createElement('span');
  backendLabel.className = 'models-voice-field__label';
  backendLabel.textContent = 'Backend';
  backendRow.appendChild(backendLabel);

  const toggle = document.createElement('div');
  toggle.className = 'models-voice-backend-toggle__buttons';
  for (const value of ['local', 'provider'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'models-inline-btn';
    btn.textContent = value === 'local' ? 'Local' : 'External API';
    btn.dataset.voiceSttBackend = value;
    btn.setAttribute('aria-pressed', config.stt.backend === value ? 'true' : 'false');
    btn.classList.toggle('is-primary', config.stt.backend === value);
    btn.addEventListener('click', () => onBackendChange?.(value));
    toggle.appendChild(btn);
  }
  backendRow.appendChild(toggle);
  mount.appendChild(backendRow);

  const providerPanel = document.createElement('div');
  providerPanel.className = 'models-voice-provider-panel';
  providerPanel.id = 'modelsVoiceSttProviderPanel';
  providerPanel.hidden = config.stt.backend !== 'provider';
  providerPanel.innerHTML = `
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceSttProviderId">Provider</label>
      <select class="models-voice-field__input" id="voiceSttProviderId"></select>
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceSttProviderModel">Model</label>
      <input class="models-voice-field__input" id="voiceSttProviderModel" type="text" />
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceSttProviderLanguage">Language</label>
      <input class="models-voice-field__input" id="voiceSttProviderLanguage" type="text" />
    </div>
  `;
  mount.appendChild(providerPanel);

  const localPanel = document.createElement('div');
  localPanel.className = 'models-voice-local-panel';
  localPanel.id = 'modelsVoiceSttLocalPanel';
  localPanel.hidden = config.stt.backend !== 'local';

  const basic = document.createElement('fieldset');
  basic.className = 'models-voice-fieldset';
  const basicLegend = document.createElement('legend');
  basicLegend.textContent = 'Decoding';
  basic.appendChild(basicLegend);
  for (const spec of BASIC_FIELDS) {
    renderField(spec, config.stt.local, catalogEntry, basic);
  }
  localPanel.appendChild(basic);

  const advanced = document.createElement('fieldset');
  advanced.className = 'models-voice-fieldset models-voice-fieldset--advanced';
  const advLegend = document.createElement('legend');
  advLegend.textContent = 'Advanced';
  advanced.appendChild(advLegend);
  for (const spec of ADVANCED_FIELDS) {
    renderField(spec, config.stt.local, catalogEntry, advanced);
  }
  localPanel.appendChild(advanced);

  mount.appendChild(localPanel);
}

/** Sync provider panel values from config. */
export function fillSttProviderPanel(config: VoiceConfig): void {
  const providerSelect = document.getElementById('voiceSttProviderId') as HTMLSelectElement | null;
  const modelInput = document.getElementById('voiceSttProviderModel') as HTMLInputElement | null;
  const langInput = document.getElementById('voiceSttProviderLanguage') as HTMLInputElement | null;
  if (providerSelect) providerSelect.value = config.stt.provider.providerId;
  if (modelInput) modelInput.value = config.stt.provider.model;
  if (langInput) langInput.value = config.stt.provider.language;
}

/** Read provider fields from the STT provider panel. */
export function readSttProviderFromForm(config: VoiceConfig): VoiceConfig['stt']['provider'] {
  const providerSelect = document.getElementById('voiceSttProviderId') as HTMLSelectElement | null;
  const modelInput = document.getElementById('voiceSttProviderModel') as HTMLInputElement | null;
  const langInput = document.getElementById('voiceSttProviderLanguage') as HTMLInputElement | null;
  return {
    ...config.stt.provider,
    providerId: providerSelect?.value?.trim() ?? config.stt.provider.providerId,
    model: modelInput?.value?.trim() ?? config.stt.provider.model,
    language: langInput?.value?.trim() ?? config.stt.provider.language,
  };
}

/** Toggle local vs provider panels after backend change. */
export function setSttBackendUi(backend: 'local' | 'provider'): void {
  const providerPanel = document.getElementById('modelsVoiceSttProviderPanel');
  const localPanel = document.getElementById('modelsVoiceSttLocalPanel');
  providerPanel?.toggleAttribute('hidden', backend !== 'provider');
  localPanel?.toggleAttribute('hidden', backend !== 'local');
  for (const btn of document.querySelectorAll('[data-voice-stt-backend]')) {
    const el = btn as HTMLButtonElement;
    const active = el.dataset.voiceSttBackend === backend;
    el.classList.toggle('is-primary', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

// --- TTS settings form ---

type TtsBackend = 'local' | 'provider' | 'browser';

interface TtsFieldSpec {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'file';
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  panel?: 'customVoice' | 'voiceDesign' | 'voiceClone' | 'generation' | 'runtime';
  readOnly?: boolean;
}

function ttsFieldId(id: string): string {
  return `voiceTts_${id}`;
}

function renderTtsControl(spec: TtsFieldSpec, value: unknown, mount: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'models-voice-field';
  wrap.dataset.ttsPanel = spec.panel ?? '';

  const label = document.createElement('label');
  label.className = 'models-voice-field__label';
  label.htmlFor = ttsFieldId(spec.id);
  label.textContent = spec.label;
  wrap.appendChild(label);

  let control: HTMLInputElement | HTMLSelectElement;
  if (spec.type === 'checkbox') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(value);
    control = checkbox;
  } else if (spec.type === 'select') {
    const select = document.createElement('select');
    select.className = 'models-voice-field__input';
    for (const opt of spec.options ?? []) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (String(value) === opt.value) option.selected = true;
      select.appendChild(option);
    }
    control = select;
  } else if (spec.type === 'file') {
    const fileInput = document.createElement('input');
    fileInput.className = 'models-voice-field__input';
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    control = fileInput;
  } else {
    const textInput = document.createElement('input');
    textInput.className = 'models-voice-field__input';
    textInput.type = spec.type;
    if (spec.type === 'number') {
      if (spec.min != null) textInput.min = String(spec.min);
      if (spec.max != null) textInput.max = String(spec.max);
      if (spec.step != null) textInput.step = String(spec.step);
    }
    textInput.value = String(value ?? '');
    if (spec.readOnly) textInput.readOnly = true;
    control = textInput;
  }

  control.id = ttsFieldId(spec.id);
  control.dataset.voiceTtsKey = spec.id;
  wrap.appendChild(control);

  if (spec.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = spec.hint;
    wrap.appendChild(hint);
  }

  mount.appendChild(wrap);
}

function setTtsModePanels(mode: VoiceTtsLocalConfig['mode']): void {
  for (const panel of document.querySelectorAll('[data-tts-mode-panel]')) {
    const el = panel as HTMLElement;
    el.hidden = el.dataset.ttsModePanel !== mode;
  }
}

export interface RenderTtsSettingsFormOptions {
  mount: HTMLElement;
  config: VoiceConfig;
  catalogEntry?: TtsCatalogEntry;
  clonePrompts?: Array<{ id: string; label: string }>;
  onBackendChange?: (backend: TtsBackend) => void;
  onModeChange?: (mode: VoiceTtsLocalConfig['mode']) => void;
}

/** Render backend toggle + mode-gated TTS settings groups. */
export function renderTtsSettingsForm(options: RenderTtsSettingsFormOptions): void {
  const { mount, config, catalogEntry, clonePrompts, onBackendChange, onModeChange } = options;
  mount.replaceChildren();

  const backendRow = document.createElement('div');
  backendRow.className = 'models-voice-backend-toggle';
  backendRow.appendChild(Object.assign(document.createElement('span'), {
    className: 'models-voice-field__label',
    textContent: 'Backend',
  }));
  const toggle = document.createElement('div');
  toggle.className = 'models-voice-backend-toggle__buttons';
  for (const value of ['local', 'provider', 'browser'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'models-inline-btn';
    btn.textContent =
      value === 'local' ? 'Local' : value === 'provider' ? 'External API' : 'Browser';
    btn.dataset.voiceTtsBackend = value;
    btn.setAttribute('aria-pressed', config.tts.backend === value ? 'true' : 'false');
    btn.classList.toggle('is-primary', config.tts.backend === value);
    btn.addEventListener('click', () => onBackendChange?.(value));
    toggle.appendChild(btn);
  }
  backendRow.appendChild(toggle);
  mount.appendChild(backendRow);

  const providerPanel = document.createElement('div');
  providerPanel.id = 'modelsVoiceTtsProviderPanel';
  providerPanel.hidden = config.tts.backend !== 'provider';
  providerPanel.innerHTML = `
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsProviderId">Provider</label>
      <select class="models-voice-field__input" id="voiceTtsProviderId"></select>
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsProviderModel">Model</label>
      <input class="models-voice-field__input" id="voiceTtsProviderModel" type="text" />
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsProviderVoice">Voice</label>
      <input class="models-voice-field__input" id="voiceTtsProviderVoice" type="text" />
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsProviderSpeed">Speed</label>
      <input class="models-voice-field__input" id="voiceTtsProviderSpeed" type="number" min="0.25" max="4" step="0.05" />
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsProviderFormat">Format</label>
      <select class="models-voice-field__input" id="voiceTtsProviderFormat">
        <option value="mp3">mp3</option>
        <option value="wav">wav</option>
        <option value="opus">opus</option>
        <option value="aac">aac</option>
        <option value="flac">flac</option>
      </select>
    </div>
  `;
  mount.appendChild(providerPanel);

  const browserPanel = document.createElement('div');
  browserPanel.id = 'modelsVoiceTtsBrowserPanel';
  browserPanel.hidden = config.tts.backend !== 'browser';
  browserPanel.innerHTML = `
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsBrowserVoice">speechSynthesis voice</label>
      <select class="models-voice-field__input" id="voiceTtsBrowserVoice"></select>
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsBrowserRate">Rate</label>
      <input class="models-voice-field__input" id="voiceTtsBrowserRate" type="number" min="0.25" max="4" step="0.05" />
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsBrowserPitch">Pitch</label>
      <input class="models-voice-field__input" id="voiceTtsBrowserPitch" type="number" min="0" max="2" step="0.05" />
    </div>
    <div class="models-voice-field">
      <label class="models-voice-field__label" for="voiceTtsBrowserVolume">Volume</label>
      <input class="models-voice-field__input" id="voiceTtsBrowserVolume" type="number" min="0" max="1" step="0.05" />
    </div>
  `;
  mount.appendChild(browserPanel);

  const localPanel = document.createElement('div');
  localPanel.id = 'modelsVoiceTtsLocalPanel';
  localPanel.hidden = config.tts.backend !== 'local';

  const runtime = document.createElement('fieldset');
  runtime.className = 'models-voice-fieldset';
  runtime.dataset.ttsModePanel = 'runtime';
  runtime.appendChild(Object.assign(document.createElement('legend'), { textContent: 'Runtime' }));
  const speakers = catalogEntry?.speakers ?? [];
  renderTtsControl(
    {
      id: 'modelId',
      label: 'Model',
      type: 'text',
      panel: 'runtime',
      readOnly: true,
    },
    config.tts.local.modelId,
    runtime,
  );
  renderTtsControl(
    {
      id: 'deviceMap',
      label: 'Device map',
      type: 'select',
      panel: 'runtime',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'cuda:0', label: 'CUDA GPU' },
        { value: 'cpu', label: 'CPU' },
      ],
    },
    config.tts.local.deviceMap,
    runtime,
  );
  renderTtsControl(
    {
      id: 'dtype',
      label: 'Dtype',
      type: 'select',
      panel: 'runtime',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'bfloat16', label: 'bfloat16' },
        { value: 'float16', label: 'float16' },
        { value: 'float32', label: 'float32' },
      ],
    },
    config.tts.local.dtype,
    runtime,
  );
  renderTtsControl(
    {
      id: 'attnImplementation',
      label: 'Attention',
      type: 'select',
      panel: 'runtime',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'flash_attention_2', label: 'Flash Attention 2' },
        { value: 'sdpa', label: 'SDPA' },
        { value: 'eager', label: 'Eager' },
      ],
    },
    config.tts.local.attnImplementation,
    runtime,
  );
  const streamingRow = document.createElement('div');
  streamingRow.className = 'models-voice-field';
  streamingRow.innerHTML = `
    <label class="models-voice-field__label" for="voiceTtsStreaming">Streaming</label>
    <input type="checkbox" id="voiceTtsStreaming" ${config.tts.streaming ? 'checked' : ''} />
  `;
  runtime.appendChild(streamingRow);
  localPanel.appendChild(runtime);

  const modePanel = document.createElement('div');
  modePanel.className = 'models-voice-field';
  const modeLabel = document.createElement('label');
  modeLabel.className = 'models-voice-field__label';
  modeLabel.htmlFor = 'voiceTtsMode';
  modeLabel.textContent = 'Mode';
  modePanel.appendChild(modeLabel);
  const modeSelect = document.createElement('select');
  modeSelect.id = 'voiceTtsMode';
  modeSelect.className = 'models-voice-field__input';
  for (const value of ['custom_voice', 'voice_design', 'voice_clone'] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent =
      value === 'custom_voice'
        ? 'Custom voice'
        : value === 'voice_design'
          ? 'Voice design'
          : 'Voice clone';
    if (config.tts.local.mode === value) opt.selected = true;
    modeSelect.appendChild(opt);
  }
  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value as VoiceTtsLocalConfig['mode'];
    setTtsModePanels(mode);
    onModeChange?.(mode);
  });
  modePanel.appendChild(modeSelect);
  localPanel.appendChild(modePanel);

  const customPanel = document.createElement('fieldset');
  customPanel.className = 'models-voice-fieldset';
  customPanel.dataset.ttsModePanel = 'custom_voice';
  customPanel.appendChild(Object.assign(document.createElement('legend'), { textContent: 'Custom voice' }));
  renderTtsControl(
    {
      id: 'customVoice.speaker',
      label: 'Speaker',
      type: speakers.length ? 'select' : 'text',
      panel: 'customVoice',
      options: speakers.map((s) => ({ value: s, label: s })),
    },
    config.tts.local.customVoice.speaker,
    customPanel,
  );
  renderTtsControl(
    { id: 'customVoice.language', label: 'Language', type: 'text', panel: 'customVoice' },
    config.tts.local.customVoice.language,
    customPanel,
  );
  if (catalogEntry?.instructControl) {
    renderTtsControl(
      {
        id: 'customVoice.instruct',
        label: 'Instruct',
        type: 'text',
        panel: 'customVoice',
        hint: 'Style control (1.7B CustomVoice only)',
      },
      config.tts.local.customVoice.instruct,
      customPanel,
    );
  }
  localPanel.appendChild(customPanel);

  const designPanel = document.createElement('fieldset');
  designPanel.className = 'models-voice-fieldset';
  designPanel.dataset.ttsModePanel = 'voice_design';
  designPanel.appendChild(Object.assign(document.createElement('legend'), { textContent: 'Voice design' }));
  renderTtsControl(
    { id: 'voiceDesign.language', label: 'Language', type: 'text', panel: 'voiceDesign' },
    config.tts.local.voiceDesign.language,
    designPanel,
  );
  renderTtsControl(
    {
      id: 'voiceDesign.instruct',
      label: 'Instruct',
      type: 'text',
      panel: 'voiceDesign',
      hint: 'Natural-language voice description (required)',
    },
    config.tts.local.voiceDesign.instruct,
    designPanel,
  );
  localPanel.appendChild(designPanel);

  const clonePanel = document.createElement('fieldset');
  clonePanel.className = 'models-voice-fieldset';
  clonePanel.dataset.ttsModePanel = 'voice_clone';
  clonePanel.appendChild(Object.assign(document.createElement('legend'), { textContent: 'Voice clone' }));
  renderTtsControl(
    {
      id: 'voiceClone.refAudioUpload',
      label: 'Reference audio',
      type: 'file',
      panel: 'voiceClone',
      hint: 'Upload 3+ seconds of reference speech',
    },
    '',
    clonePanel,
  );
  renderTtsControl(
    { id: 'voiceClone.refAudioPath', label: 'Saved ref path', type: 'text', panel: 'voiceClone', readOnly: true },
    config.tts.local.voiceClone.refAudioPath,
    clonePanel,
  );
  renderTtsControl(
    { id: 'voiceClone.refText', label: 'Reference transcript', type: 'text', panel: 'voiceClone' },
    config.tts.local.voiceClone.refText,
    clonePanel,
  );
  renderTtsControl(
    {
      id: 'voiceClone.xVectorOnlyMode',
      label: 'X-vector only mode',
      type: 'checkbox',
      panel: 'voiceClone',
    },
    config.tts.local.voiceClone.xVectorOnlyMode,
    clonePanel,
  );
  renderTtsControl(
    { id: 'voiceClone.language', label: 'Language', type: 'text', panel: 'voiceClone' },
    config.tts.local.voiceClone.language,
    clonePanel,
  );
  const promptRow = document.createElement('div');
  promptRow.className = 'models-voice-field';
  const promptLabel = document.createElement('label');
  promptLabel.className = 'models-voice-field__label';
  promptLabel.htmlFor = 'voiceClone.savedPromptId';
  promptLabel.textContent = 'Saved prompt';
  promptRow.appendChild(promptLabel);
  const promptSelect = document.createElement('select');
  promptSelect.id = 'voiceClone.savedPromptId';
  promptSelect.className = 'models-voice-field__input';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = 'None';
  promptSelect.appendChild(emptyOpt);
  for (const prompt of clonePrompts ?? []) {
    const opt = document.createElement('option');
    opt.value = prompt.id;
    opt.textContent = prompt.label;
    if (config.tts.local.voiceClone.savedPromptId === prompt.id) opt.selected = true;
    promptSelect.appendChild(opt);
  }
  promptRow.appendChild(promptSelect);
  clonePanel.appendChild(promptRow);
  localPanel.appendChild(clonePanel);

  const generation = document.createElement('fieldset');
  generation.className = 'models-voice-fieldset models-voice-fieldset--advanced';
  generation.appendChild(Object.assign(document.createElement('legend'), { textContent: 'Generation (advanced)' }));
  renderTtsControl(
    { id: 'generation.maxNewTokens', label: 'Max new tokens', type: 'number', min: 256, max: 4096, step: 1, panel: 'generation' },
    config.tts.local.generation.maxNewTokens,
    generation,
  );
  renderTtsControl(
    { id: 'generation.topP', label: 'Top P', type: 'number', min: 0, max: 1, step: 0.05, panel: 'generation' },
    config.tts.local.generation.topP,
    generation,
  );
  renderTtsControl(
    { id: 'generation.topK', label: 'Top K', type: 'number', min: 1, max: 200, step: 1, panel: 'generation' },
    config.tts.local.generation.topK,
    generation,
  );
  renderTtsControl(
    { id: 'generation.temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.05, panel: 'generation' },
    config.tts.local.generation.temperature,
    generation,
  );
  renderTtsControl(
    { id: 'generation.repetitionPenalty', label: 'Repetition penalty', type: 'number', min: 0.5, max: 2, step: 0.05, panel: 'generation' },
    config.tts.local.generation.repetitionPenalty,
    generation,
  );
  localPanel.appendChild(generation);

  mount.appendChild(localPanel);
  setTtsModePanels(config.tts.local.mode);
}

function readTtsNestedValue(
  local: VoiceTtsLocalConfig,
  key: string,
): unknown {
  if (key === 'modelId') return local.modelId;
  if (key === 'deviceMap') return local.deviceMap;
  if (key === 'dtype') return local.dtype;
  if (key === 'attnImplementation') return local.attnImplementation;
  const parts = key.split('.');
  if (parts.length === 2) {
    const [group, field] = parts as [keyof VoiceTtsLocalConfig, string];
    const section = local[group];
    if (section && typeof section === 'object' && field in section) {
      return (section as unknown as Record<string, unknown>)[field];
    }
  }
  return undefined;
}

function setTtsNestedValue(local: VoiceTtsLocalConfig, key: string, value: unknown): void {
  if (key === 'modelId' && typeof value === 'string') local.modelId = value;
  else if (key === 'deviceMap' && typeof value === 'string') local.deviceMap = value as VoiceTtsLocalConfig['deviceMap'];
  else if (key === 'dtype' && typeof value === 'string') local.dtype = value as VoiceTtsLocalConfig['dtype'];
  else if (key === 'attnImplementation' && typeof value === 'string') {
    local.attnImplementation = value as VoiceTtsLocalConfig['attnImplementation'];
  } else {
    const parts = key.split('.');
    if (parts.length === 2) {
      const [group, field] = parts;
      if (group === 'customVoice' || group === 'voiceDesign' || group === 'voiceClone' || group === 'generation') {
        (local[group] as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }
}

/** Read local TTS config from rendered form controls. */
export function readTtsLocalFromForm(base: VoiceTtsLocalConfig): VoiceTtsLocalConfig {
  const out = structuredClone(base);
  for (const el of document.querySelectorAll('[data-voice-tts-key]')) {
    const key = (el as HTMLElement).dataset.voiceTtsKey;
    if (!key || key === 'voiceClone.refAudioUpload') continue;
    let value: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'number') {
      const n = Number(el.value);
      value = Number.isFinite(n) ? n : readTtsNestedValue(out, key);
    } else value = (el as HTMLInputElement | HTMLSelectElement).value;
    setTtsNestedValue(out, key, value);
  }
  const modeSelect = document.getElementById('voiceTtsMode') as HTMLSelectElement | null;
  if (modeSelect?.value === 'custom_voice' || modeSelect?.value === 'voice_design' || modeSelect?.value === 'voice_clone') {
    out.mode = modeSelect.value;
  }
  const promptSelect = document.getElementById('voiceClone.savedPromptId') as HTMLSelectElement | null;
  if (promptSelect) out.voiceClone.savedPromptId = promptSelect.value;
  return out;
}

export function fillTtsProviderPanel(config: VoiceConfig): void {
  const providerSelect = document.getElementById('voiceTtsProviderId') as HTMLSelectElement | null;
  const modelInput = document.getElementById('voiceTtsProviderModel') as HTMLInputElement | null;
  const voiceInput = document.getElementById('voiceTtsProviderVoice') as HTMLInputElement | null;
  const speedInput = document.getElementById('voiceTtsProviderSpeed') as HTMLInputElement | null;
  const formatSelect = document.getElementById('voiceTtsProviderFormat') as HTMLSelectElement | null;
  if (providerSelect) providerSelect.value = config.tts.provider.providerId;
  if (modelInput) modelInput.value = config.tts.provider.model;
  if (voiceInput) voiceInput.value = config.tts.provider.voice;
  if (speedInput) speedInput.value = String(config.tts.provider.speed);
  if (formatSelect) formatSelect.value = config.tts.provider.format;
}

export function fillTtsBrowserPanel(config: VoiceConfig): void {
  const voiceSelect = document.getElementById('voiceTtsBrowserVoice') as HTMLSelectElement | null;
  const rateInput = document.getElementById('voiceTtsBrowserRate') as HTMLInputElement | null;
  const pitchInput = document.getElementById('voiceTtsBrowserPitch') as HTMLInputElement | null;
  const volumeInput = document.getElementById('voiceTtsBrowserVolume') as HTMLInputElement | null;
  if (rateInput) rateInput.value = String(config.tts.browser.rate);
  if (pitchInput) pitchInput.value = String(config.tts.browser.pitch);
  if (volumeInput) volumeInput.value = String(config.tts.browser.volume);
  if (!voiceSelect) return;
  voiceSelect.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'System default';
  voiceSelect.appendChild(defaultOpt);
  if ('speechSynthesis' in window) {
    for (const voice of window.speechSynthesis.getVoices()) {
      const opt = document.createElement('option');
      opt.value = voice.voiceURI;
      opt.textContent = `${voice.name} (${voice.lang})`;
      voiceSelect.appendChild(opt);
    }
  }
  if (config.tts.browser.voiceUri) voiceSelect.value = config.tts.browser.voiceUri;
}

export function readTtsProviderFromForm(config: VoiceConfig): VoiceConfig['tts']['provider'] {
  const providerSelect = document.getElementById('voiceTtsProviderId') as HTMLSelectElement | null;
  const modelInput = document.getElementById('voiceTtsProviderModel') as HTMLInputElement | null;
  const voiceInput = document.getElementById('voiceTtsProviderVoice') as HTMLInputElement | null;
  const speedInput = document.getElementById('voiceTtsProviderSpeed') as HTMLInputElement | null;
  const formatSelect = document.getElementById('voiceTtsProviderFormat') as HTMLSelectElement | null;
  return {
    ...config.tts.provider,
    providerId: providerSelect?.value?.trim() ?? config.tts.provider.providerId,
    model: modelInput?.value?.trim() ?? config.tts.provider.model,
    voice: voiceInput?.value?.trim() ?? config.tts.provider.voice,
    speed: Number(speedInput?.value) || config.tts.provider.speed,
    format: (formatSelect?.value as VoiceConfig['tts']['provider']['format']) ?? config.tts.provider.format,
  };
}

export function readTtsBrowserFromForm(config: VoiceConfig): VoiceConfig['tts']['browser'] {
  const voiceSelect = document.getElementById('voiceTtsBrowserVoice') as HTMLSelectElement | null;
  const rateInput = document.getElementById('voiceTtsBrowserRate') as HTMLInputElement | null;
  const pitchInput = document.getElementById('voiceTtsBrowserPitch') as HTMLInputElement | null;
  const volumeInput = document.getElementById('voiceTtsBrowserVolume') as HTMLInputElement | null;
  return {
    ...config.tts.browser,
    voiceUri: voiceSelect?.value ?? config.tts.browser.voiceUri,
    rate: Number(rateInput?.value) || config.tts.browser.rate,
    pitch: Number(pitchInput?.value) || config.tts.browser.pitch,
    volume: Number(volumeInput?.value) || config.tts.browser.volume,
  };
}

export function setTtsBackendUi(backend: TtsBackend): void {
  document.getElementById('modelsVoiceTtsProviderPanel')?.toggleAttribute('hidden', backend !== 'provider');
  document.getElementById('modelsVoiceTtsBrowserPanel')?.toggleAttribute('hidden', backend !== 'browser');
  document.getElementById('modelsVoiceTtsLocalPanel')?.toggleAttribute('hidden', backend !== 'local');
  for (const btn of document.querySelectorAll('[data-voice-tts-backend]')) {
    const el = btn as HTMLButtonElement;
    const active = el.dataset.voiceTtsBackend === backend;
    el.classList.toggle('is-primary', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

/** Return the ref-audio file input if the user selected a new upload. */
export function getTtsRefAudioUpload(): File | null {
  const el = document.getElementById(ttsFieldId('voiceClone.refAudioUpload')) as HTMLInputElement | null;
  const file = el?.files?.[0];
  return file ?? null;
}

