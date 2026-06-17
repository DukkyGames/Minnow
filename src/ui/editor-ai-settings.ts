/**
 * Settings UI for editor AI inline completion (POLISH-006).
 */

import {
  loadEditorAiCompletionConfig,
  saveEditorAiCompletionConfig,
  type EditorAiCompletionConfig,
} from '../config/editor-ai-completion';
import { getActiveChat } from '../state/sessions';
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import {
  appendProviderModelFields,
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';
import { isLocalServerAvailable } from '../tools/config';
import { appendEditorFundamentalsSettings } from './editor-fundamentals-settings';
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

function serverBanner(message: string): HTMLElement {
  const p = el('p', 'settings-server-banner');
  p.setAttribute('role', 'status');
  p.innerHTML = message;
  return p;
}

function appendSummaryKv(
  mount: HTMLElement,
  rows: Array<{ term: string; value: string | HTMLElement }>,
): void {
  const dl = el('dl', 'settings-kv');
  for (const { term, value } of rows) {
    dl.append(el('dt', 'settings-kv__term', term));
    const dd = el('dd', 'settings-kv__value');
    if (typeof value === 'string') dd.textContent = value;
    else dd.append(value);
    dl.append(dd);
  }
  mount.append(dl);
}

function kbdKey(label: string): HTMLElement {
  return el('kbd', 'settings-editor-kbd', label);
}

function statusReadout(enabled: boolean): HTMLElement {
  const wrap = el(
    'span',
    `settings-mcp-status ${enabled ? 'settings-mcp-status--ok' : ''}`,
  );
  wrap.setAttribute(
    'aria-label',
    enabled ? 'Inline completion enabled' : 'Inline completion disabled',
  );
  const dot = el('span', 'settings-mcp-status-dot');
  dot.setAttribute('aria-hidden', 'true');
  wrap.append(dot, el('span', 'settings-mcp-status-text', enabled ? 'On' : 'Off'));
  return wrap;
}

function isEffectiveModelMissing(config: EditorAiCompletionConfig): boolean {
  if (!isPinnedModelSource(config)) {
    const chat = getActiveChat();
    return !chat.modelId?.trim();
  }
  return !config.modelId.trim();
}

function isPinnedModelSource(config: EditorAiCompletionConfig): boolean {
  return !config.useChatModel || config.providerId.trim().length > 0;
}

function formatEffectiveModel(config: EditorAiCompletionConfig): string {
  if (!isPinnedModelSource(config)) {
    const chat = getActiveChat();
    const provider = chat.providerId?.trim() || '—';
    const model = chat.modelId?.trim() || '—';
    return `${provider} / ${model}`;
  }
  const provider = config.providerId.trim() || '—';
  const model = config.modelId.trim() || '—';
  return `${provider} / ${model}`;
}

function appendModelWarning(mount: HTMLElement): void {
  const warning = el('p', 'settings-server-banner settings-editor-model-warning');
  warning.setAttribute('role', 'status');
  warning.textContent =
    'No model assigned — editor AI and Quick Edit will show an error until you select a model in the chat bar or pin one below.';
  mount.append(warning);
}

function appendCrosslinks(mount: HTMLElement): void {
  const cross = el('div', 'settings-crosslinks');
  cross.append(el('span', 'settings-crosslinks__label', 'Related'));
  cross.append(
    linkToSettingsSection('Providers', 'providers'),
    linkToSettingsSection('Language servers', 'lsp'),
    linkToSettingsSection('Models', 'model-routing'),
  );
  mount.append(cross);
}

function mountModelSourceBlock(
  body: HTMLElement,
  config: EditorAiCompletionConfig,
  onRefresh: () => void,
): void {
  const chatRadio = el('input') as HTMLInputElement;
  chatRadio.type = 'radio';
  chatRadio.name = 'editorAiModelSource';
  chatRadio.id = 'editorAiModelSourceChat';

  const pinRadio = el('input') as HTMLInputElement;
  pinRadio.type = 'radio';
  pinRadio.name = 'editorAiModelSource';
  pinRadio.id = 'editorAiModelSourcePin';

  const pinned = isPinnedModelSource(config);
  if (pinned) pinRadio.checked = true;
  else chatRadio.checked = true;

  const sourceRow = el('div', 'settings-editor-source-radios');
  const chatLabel = el('label', 'settings-inline-radio');
  chatLabel.htmlFor = 'editorAiModelSourceChat';
  chatLabel.append(chatRadio, document.createTextNode(' Follow active chat'));
  const pinLabel = el('label', 'settings-inline-radio');
  pinLabel.htmlFor = 'editorAiModelSourcePin';
  pinLabel.append(pinRadio, document.createTextNode(' Pin provider and model'));
  sourceRow.append(chatLabel, pinLabel);
  body.appendChild(sourceRow);

  const overridePanel = el('div', 'settings-editor-model-panel');
  overridePanel.hidden = !pinned;

  const grid = el('div', 'settings-editor-model-grid settings-routing-row__selects');
  const { providerSelect, modelSelect } = appendProviderModelFields(
    grid,
    { provider: 'settingsEditorProvider', model: 'settingsEditorModel' },
    { provider: 'Provider', model: 'Model' },
    'inline',
  );
  overridePanel.append(grid);
  body.appendChild(overridePanel);

  const effective = el('p', 'settings-editor-effective');
  effective.append(
    el('span', 'settings-editor-effective__label', 'Effective'),
    el('code', 'settings-editor-effective__value', formatEffectiveModel(config)),
  );
  body.appendChild(effective);

  const effectiveValue = effective.querySelector(
    '.settings-editor-effective__value',
  ) as HTMLElement;

  const refreshEffective = (): void => {
    const next: EditorAiCompletionConfig = {
      ...config,
      useChatModel: chatRadio.checked,
      providerId: providerSelect.value.trim(),
      modelId: modelSelect.value.trim(),
    };
    effectiveValue.textContent = formatEffectiveModel(next);
  };

  const persistPinned = (): void => {
    void saveEditorAiCompletionConfig({
      providerId: providerSelect.value.trim(),
      modelId: modelSelect.value.trim(),
      useChatModel: false,
    }).then(() => {
      setStatus('ok', 'Pinned model saved');
      onRefresh();
    });
  };

  void (async () => {
    await fillProviderSelect(providerSelect, config.providerId);
    await fillModelSelect(
      modelSelect,
      config.providerId || providerSelect.value,
      config.modelId,
      { includeEmptyOption: false },
    );
  })();

  const syncPinnedVisibility = (): void => {
    overridePanel.hidden = !pinRadio.checked;
  };

  chatRadio.addEventListener('change', () => {
    if (!chatRadio.checked) return;
    void saveEditorAiCompletionConfig({
      useChatModel: true,
      providerId: '',
      modelId: '',
    }).then(() => {
      setStatus('ok', 'Using active chat model');
      onRefresh();
    });
  });

  pinRadio.addEventListener('change', () => {
    if (!pinRadio.checked) return;
    syncPinnedVisibility();
    void saveEditorAiCompletionConfig({ useChatModel: false }).then(() => {
      setStatus('ok', 'Choose a provider and model below');
      onRefresh();
    });
  });

  providerSelect.addEventListener('change', () => {
    void fillModelSelect(modelSelect, providerSelect.value, '', {
      includeEmptyOption: false,
    }).then(() => {
      refreshEffective();
      if (providerSelect.value.trim()) persistPinned();
    });
  });

  modelSelect.addEventListener('change', () => {
    refreshEffective();
    persistPinned();
  });
}

function renderEditorSettingsBody(
  mount: HTMLElement,
  config: EditorAiCompletionConfig,
  online: boolean,
): void {
  const refresh = (): void => {
    void renderEditorSettingsSection();
  };

  if (!online) {
    mount.append(
      serverBanner(
        'Start with <code>npm start</code> to sync settings to <code>~/.minnow/config.json</code>. Changes below are stored in the browser until then.',
      ),
    );
  }

  const overview = appendSettingsGroup(
    mount,
    'Overview',
    'Inline suggestions in the file viewer. Symbol completion (Ctrl+Space) comes from language servers and does not require a chat model.',
  );

  appendSummaryKv(overview, [
    { term: 'Completion', value: statusReadout(config.enabled) },
    {
      term: 'Model',
      value: formatEffectiveModel(config),
    },
    {
      term: 'Debounce',
      value: `${config.debounceMs} ms`,
    },
    {
      term: 'Storage',
      value: online ? '~/.minnow/config.json' : 'Browser (until npm start)',
    },
  ]);
  appendCrosslinks(overview);

  const ghost = appendSettingsGroup(mount, 'Ghost text');
  if (!config.enabled) {
    ghost.append(
      el(
        'p',
        'settings-group__lead',
        'Off. Turn on to fetch suggestions after a short pause while you edit.',
      ),
    );
  } else {
    ghost.append(
      el(
        'p',
        'settings-group__lead',
        'Shown after you stop typing. Hidden in read-only excerpts and markdown preview.',
      ),
    );
  }

  const { row: enableRow } = createSettingsToggleRow('Enable inline completion', {
    checked: config.enabled,
    ariaLabel: 'Enable AI inline completion in the file editor',
    onChange: async (enabled) => {
      await saveEditorAiCompletionConfig({ enabled });
      setStatus('ok', enabled ? 'Inline completion on' : 'Inline completion off');
      refresh();
    },
  });
  ghost.append(enableRow);

  const shortcuts = el('dl', 'settings-kv settings-editor-shortcuts');
  shortcuts.append(el('dt', 'settings-kv__term', 'Accept'));
  const acceptDd = el('dd', 'settings-kv__value');
  acceptDd.append(kbdKey('Tab'), document.createTextNode(' insert suggestion'));
  shortcuts.append(acceptDd);
  shortcuts.append(el('dt', 'settings-kv__term', 'Dismiss'));
  const dismissDd = el('dd', 'settings-kv__value');
  dismissDd.append(kbdKey('Esc'), document.createTextNode(' clear ghost text'));
  shortcuts.append(dismissDd);
  shortcuts.append(el('dt', 'settings-kv__term', 'Partial accept'));
  const partialDd = el('dd', 'settings-kv__value');
  partialDd.append(
    kbdKey('Ctrl'),
    document.createTextNode('+'),
    kbdKey('→'),
    document.createTextNode(' accept next word/line'),
  );
  shortcuts.append(partialDd);
  ghost.append(shortcuts);

  const debounceKv = el('dl', 'settings-kv settings-editor-debounce');
  debounceKv.append(el('dt', 'settings-kv__term', 'Pause before request'));
  const debounceDd = el('dd', 'settings-kv__value');
  const debounceWrap = el('span', 'settings-kv-input-wrap settings-editor-debounce__control');
  const debounceInput = document.createElement('input');
  debounceInput.type = 'number';
  debounceInput.id = 'settingsEditorDebounceMs';
  debounceInput.min = '200';
  debounceInput.max = '2000';
  debounceInput.step = '50';
  debounceInput.value = String(config.debounceMs);
  debounceInput.className = 'settings-select settings-kv-input';
  debounceInput.setAttribute('aria-label', 'Debounce milliseconds before requesting a completion');
  debounceWrap.append(debounceInput, el('span', 'settings-kv-suffix', 'ms'));
  debounceDd.append(debounceWrap);
  debounceKv.append(debounceDd);
  debounceInput.addEventListener('change', () => {
    const raw = Number(debounceInput.value);
    const ms = Number.isFinite(raw)
      ? Math.min(2000, Math.max(200, Math.round(raw)))
      : config.debounceMs;
    debounceInput.value = String(ms);
    void saveEditorAiCompletionConfig({ debounceMs: ms }).then(() => {
      setStatus('ok', 'Debounce saved');
      refresh();
    });
  });
  ghost.append(debounceKv);

  const advanced = appendSettingsGroup(
    mount,
    'Prompt context',
    'Extra signals for inline completion requests (Quick Edit always uses chat).',
  );

  const contextToggles: Array<{
    label: string;
    key: keyof Pick<
      EditorAiCompletionConfig,
      'includeImportContext' | 'includeLspHover' | 'useNativeFim' | 'enableCompletionCache'
    >;
    aria: string;
  }> = [
    {
      label: 'Include import lines',
      key: 'includeImportContext',
      aria: 'Include import and require lines in completion prompt',
    },
    {
      label: 'Include LSP hover at cursor',
      key: 'includeLspHover',
      aria: 'Fetch LSP hover text for the symbol at the cursor when available',
    },
    {
      label: 'Qwen native FIM when supported',
      key: 'useNativeFim',
      aria: 'Use Qwen fill-in-the-middle tokens for matching models',
    },
    {
      label: 'Cache completions',
      key: 'enableCompletionCache',
      aria: 'Cache inline completions by file and surrounding context hash',
    },
  ];

  for (const toggle of contextToggles) {
    const { row } = createSettingsToggleRow(toggle.label, {
      checked: config[toggle.key],
      ariaLabel: toggle.aria,
      onChange: async (enabled) => {
        await saveEditorAiCompletionConfig({ [toggle.key]: enabled });
        setStatus('ok', `${toggle.label} ${enabled ? 'on' : 'off'}`);
        refresh();
      },
    });
    advanced.append(row);
  }

  const tokensKv = el('dl', 'settings-kv settings-editor-debounce');
  tokensKv.append(el('dt', 'settings-kv__term', 'Max completion tokens'));
  const tokensDd = el('dd', 'settings-kv__value');
  const tokensWrap = el('span', 'settings-kv-input-wrap settings-editor-debounce__control');
  const tokensInput = document.createElement('input');
  tokensInput.type = 'number';
  tokensInput.id = 'settingsEditorMaxTokens';
  tokensInput.min = '16';
  tokensInput.max = '1024';
  tokensInput.step = '16';
  tokensInput.value = String(config.maxTokens);
  tokensInput.className = 'settings-select settings-kv-input';
  tokensInput.setAttribute('aria-label', 'Maximum tokens for inline completion');
  tokensWrap.append(tokensInput);
  tokensDd.append(tokensWrap);
  tokensKv.append(tokensDd);
  tokensInput.addEventListener('change', () => {
    const raw = Number(tokensInput.value);
    const n = Number.isFinite(raw)
      ? Math.min(1024, Math.max(16, Math.round(raw)))
      : config.maxTokens;
    tokensInput.value = String(n);
    void saveEditorAiCompletionConfig({ maxTokens: n }).then(() => {
      setStatus('ok', 'Max tokens saved');
      refresh();
    });
  });
  advanced.append(tokensKv);

  const modelGroup = appendSettingsGroup(
    mount,
    'Model source',
    'Uses the top-bar provider and model for this chat unless you pin a different pair.',
  );
  if (isEffectiveModelMissing(config)) {
    appendModelWarning(modelGroup);
  }
  mountModelSourceBlock(modelGroup, config, refresh);
}

/** Render the full Editor settings section into #settingsEditorBody. */
export async function renderEditorSettingsSection(): Promise<void> {
  const mount = document.getElementById('settingsEditorBody');
  if (!mount) return;
  mount.replaceChildren();

  const online = isLocalServerAvailable();
  const config = await loadEditorAiCompletionConfig();
  await appendEditorFundamentalsSettings(mount);
  renderEditorSettingsBody(mount, config, online);
}
