/**
 * Expandable settings editors: prompt body + provider/model binding per entity.
 */

import {
  fetchWorkAgentPrompt,
  patchWorkAgentOverride,
  resetWorkAgentPromptOverride,
  saveWorkAgentPromptOverride,
  type WorkAgentPromptProfile,
} from '../agents/work-agent-prompt-api';
import {
  fetchPromptFile,
  resetPromptFileOverride,
  savePromptFileOverride,
  type PromptFileFamily,
  type PromptFileProfile,
} from '../chat/prompts/prompt-file-api';
import {
  resolveFilePromptBuiltinBaseline,
  resolveWorkAgentBuiltinBaselineText,
} from '../chat/prompts/prompt-baseline-resolve';
import { mountPromptDiffControls } from './prompt-diff-panel';
import type { ContextEnforcementPolicy } from '../chat/context-budget';
import {
  DEFAULT_ARCHIVE_CONFIG,
  normalizeArchiveConfig,
  type ArchiveConfig,
} from '../chat/archive/types';
import {
  clearArchiveDisabledReason,
  getArchiveDisabledReason,
} from '../chat/archive/index';
import { fetchBrainEmbeddingsStatus } from '../brain/client';
import { listSummarySchemaPresetIds } from '../agents/sub-agent-summary-schemas';
import { listProviders } from '../providers/store';
import { fillModelSelect } from './settings-model-binding';
import { createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';

const CONTEXT_POLICY_OPTIONS: { value: ContextEnforcementPolicy; label: string }[] = [
  { value: 'slide', label: 'Slide (drop oldest turns)' },
  { value: 'truncate', label: 'Truncate (drop oldest messages)' },
  { value: 'summarize', label: 'Summarize (compress dropped turns)' },
  { value: 'archive', label: 'Archive (Brain wiki)' },
];

function buildSummarySchemaSelect(initial: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'settings-select';
  for (const id of listSummarySchemaPresetIds()) {
    const node = document.createElement('option');
    node.value = id;
    node.textContent = id;
    sel.appendChild(node);
  }
  sel.value = initial;
  return sel;
}

function buildContextPolicySelect(initial: ContextEnforcementPolicy): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'settings-select';
  for (const opt of CONTEXT_POLICY_OPTIONS) {
    const node = document.createElement('option');
    node.value = opt.value;
    node.textContent = opt.label;
    if (opt.value === 'archive') {
      node.title =
        'Requires Brain embeddings (local or provider). Configure in Brain settings.';
    }
    sel.appendChild(node);
  }
  sel.value = initial;
  return sel;
}

/** Disable archive policy when Brain embeddings are off or unhealthy. */
async function applyArchiveEmbeddingsGate(sel: HTMLSelectElement): Promise<void> {
  const archiveOpt = [...sel.options].find((o) => o.value === 'archive');
  if (!archiveOpt) return;
  const status = await fetchBrainEmbeddingsStatus();
  const ok = status?.enabled === true && status?.healthy === true;
  archiveOpt.disabled = !ok;
  archiveOpt.title = ok
    ? 'Offload stale turns to Brain wiki pages'
    : 'Requires Brain embeddings (local or provider). Configure in Brain settings.';
  if (!ok && sel.value === 'archive') {
    sel.value = 'slide';
  }
}

function buildArchiveNumberInput(
  value: number,
  min: number,
  max: number,
  step = '1',
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-select settings-kv-input';
  input.min = String(min);
  input.max = String(max);
  input.step = step;
  input.value = String(value);
  return input;
}

function mountArchiveDisabledBanner(container: HTMLElement, onDismiss: () => void): () => void {
  const banner = el('div', 'settings-field-hint settings-archive-disabled-banner');
  banner.hidden = true;
  const text = el('span', '', '');
  const dismiss = el('button', 'settings-action-btn', 'Dismiss');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => {
    clearArchiveDisabledReason();
    banner.hidden = true;
    onDismiss();
  });
  banner.appendChild(text);
  banner.appendChild(dismiss);
  container.prepend(banner);

  return () => {
    const reason = getArchiveDisabledReason();
    if (!reason) {
      banner.hidden = true;
      return;
    }
    text.textContent = `Archive self-disabled: ${reason}`;
    banner.hidden = false;
  };
}

function mountArchiveTuningBlock(
  container: HTMLElement,
  initial: ArchiveConfig,
  isSubAgent = false,
): {
  root: HTMLElement;
  readConfig: () => ArchiveConfig;
} {
  const root = el('details', 'settings-archive-tuning');
  const summary = document.createElement('summary');
  summary.textContent = 'Archive tuning';
  root.appendChild(summary);

  if (isSubAgent) {
    const hint = el(
      'p',
      'settings-field-hint',
      'Saved for reference — sub-agents still use slide at runtime.',
    );
    root.appendChild(hint);
  }

  const stalenessInput = buildArchiveNumberInput(initial.stalenessTurns, 1, 200);
  const pressureInput = buildArchiveNumberInput(initial.pressureThreshold, 0.1, 0.99, '0.01');
  const minRecentInput = buildArchiveNumberInput(initial.minRecentTurns, 1, 50);
  const topKInput = buildArchiveNumberInput(initial.retrievalTopK, 1, 20);
  const embeddingInput = document.createElement('input');
  embeddingInput.type = 'text';
  embeddingInput.className = 'settings-select settings-kv-input';
  embeddingInput.placeholder = 'Brain default';
  embeddingInput.value = initial.embeddingModelId ?? '';

  const grid = el('div', 'settings-model-row');
  grid.appendChild(el('label', 'settings-field-label', 'Staleness turns'));
  grid.appendChild(stalenessInput);
  grid.appendChild(el('label', 'settings-field-label', 'Pressure threshold'));
  grid.appendChild(pressureInput);
  grid.appendChild(el('label', 'settings-field-label', 'Min recent turns'));
  grid.appendChild(minRecentInput);
  grid.appendChild(el('label', 'settings-field-label', 'Retrieval top K'));
  grid.appendChild(topKInput);
  grid.appendChild(el('label', 'settings-field-label', 'Embedding model id'));
  grid.appendChild(embeddingInput);
  root.appendChild(grid);

  return {
    root,
    readConfig: () =>
      normalizeArchiveConfig({
        stalenessTurns: Number(stalenessInput.value),
        pressureThreshold: Number(pressureInput.value),
        minRecentTurns: Number(minRecentInput.value),
        retrievalTopK: Number(topKInput.value),
        embeddingModelId: embeddingInput.value.trim() || undefined,
        llmRerank: initial.llmRerank,
      }) ?? { ...DEFAULT_ARCHIVE_CONFIG },
  };
}

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

export interface EntityEditorRow {
  id: string;
  label: string;
  hint?: string;
  /** Optional type chip in expandable list headers (Prompts hub). */
  badge?: string;
}

interface ModelBindingState {
  providerId: string;
  modelId: string;
}

function buildProfileTabs(
  onChange: (profile: PromptFileProfile) => void,
): { root: HTMLElement; getProfile: () => PromptFileProfile } {
  const root = el('div','settings-profile-tabs');
  root.setAttribute('role', 'tablist');
  let active: PromptFileProfile = 'full';

  const makeTab = (profile: PromptFileProfile, label: string) => {
    const btn = el('button', 'settings-profile-tab', label);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', profile === active ? 'true' : 'false');
    if (profile === active) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      active = profile;
      root.querySelectorAll('.settings-profile-tab').forEach((tab) => {
        const elTab = tab as HTMLButtonElement;
        const isActive = elTab.textContent === label;
        elTab.classList.toggle('is-active', isActive);
        elTab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      onChange(profile);
    });
    root.appendChild(btn);
  };

  makeTab('full', 'Full');
  makeTab('lite', 'Lite');

  return {
    root,
    getProfile: () => active,
  };
}

interface PromptEditorOptions {
  family: PromptFileFamily;
  entityId: string;
}

/** Mode, expert, or sub-agent prompt editor (file API). */
export function mountPromptFileEditor(
  container: HTMLElement,
  options: PromptEditorOptions,
): void {
  const { family, entityId } = options;
  let currentProfile: PromptFileProfile = 'full';
  let lastSavedContent = '';
  let builtinBaseline = '';
  let sourceLabel = el('span', 'settings-badge', '…');
  const ta = document.createElement('textarea');
  ta.className = 'settings-part-editor';
  ta.rows = 12;
  ta.placeholder = 'System prompt body for this profile';

  const reloadBaseline = async () => {
    builtinBaseline = await resolveFilePromptBuiltinBaseline(
      family,
      entityId,
      currentProfile,
    );
    diffControls.setBaseline(builtinBaseline);
    diffControls.refresh();
  };

  const reload = async () => {
    const data = await fetchPromptFile(family, entityId, currentProfile);
    if (!data) {
      sourceLabel.textContent = 'unavailable';
      ta.value = '';
      ta.disabled = true;
      lastSavedContent = '';
      await reloadBaseline();
      return;
    }
    sourceLabel.textContent = data.source === 'override' ? 'Custom override' : 'Built-in default';
    ta.value = data.content;
    lastSavedContent = data.content;
    ta.disabled = false;
    await reloadBaseline();
  };

  const tabs = buildProfileTabs((profile) => {
    currentProfile = profile;
    void reload();
  });

  container.appendChild(tabs.root);
  const meta = el('p', 'settings-field-hint');
  meta.appendChild(document.createTextNode('Source: '));
  meta.appendChild(sourceLabel);
  container.appendChild(meta);
  container.appendChild(ta);

  const diffControls = mountPromptDiffControls(container, {
    getBaseline: () => builtinBaseline,
    getCurrent: () => ta.value,
    showOfflineHint: true,
  });
  ta.addEventListener('input', () => diffControls.refresh());

  const actions = el('div','settings-actions');
  const saveBtn = el('button', 'settings-action-btn', 'Save prompt');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const saved = await savePromptFileOverride(
        family,
        entityId,
        currentProfile,
        ta.value,
      );
      if (!saved) {
        setStatus('err', 'Could not save prompt (npm start required)');
        return;
      }
      sourceLabel.textContent =
        saved.source === 'override' ? 'Custom override' : 'Built-in default';
      lastSavedContent = ta.value;
      diffControls.refresh();
      setStatus('ok', `Prompt saved (${currentProfile})`);
    })();
  });

  const resetBtn = el('button', 'settings-action-btn', 'Reset to built-in');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    const dirty = ta.value !== lastSavedContent;
    if (dirty && !confirm('Discard unsaved edits and remove your override?')) return;
    if (!dirty && !confirm('Remove your override and restore the shipped prompt?')) return;
    void (async () => {
      const restored = await resetPromptFileOverride(
        family,
        entityId,
        currentProfile,
      );
      if (!restored) {
        setStatus('err', 'No override to reset or server unavailable');
        return;
      }
      ta.value = restored.content;
      lastSavedContent = restored.content;
      sourceLabel.textContent = 'Built-in default';
      await reloadBaseline();
      setStatus('ok', 'Prompt reset to built-in');
    })();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(resetBtn);
  container.appendChild(actions);

  void reload();
}

interface WorkAgentEditorOptions {
  agentId: string;
  initialProviderId: string | null;
  initialModelId: string | null;
  initialDisabled: boolean;
  initialMaxInputTokens: number | null;
  initialContextPolicy: ContextEnforcementPolicy;
  initialArchive?: ArchiveConfig;
  onModelSaved?: () => void;
}

/** Work agent Full/Lite prompt editor only (Models hub holds binding). */
export function mountWorkAgentPromptEditor(
  container: HTMLElement,
  options: Pick<WorkAgentEditorOptions, 'agentId'>,
): void {
  let currentProfile: WorkAgentPromptProfile = 'full';
  let lastSavedPromptContent = '';
  let builtinBaseline = '';

  const sourceLabel = el('span', 'settings-badge', '…');
  const ta = document.createElement('textarea');
  ta.className = 'settings-part-editor';
  ta.rows = 12;

  const reloadBaseline = async () => {
    builtinBaseline = await resolveWorkAgentBuiltinBaselineText(
      options.agentId,
      currentProfile,
    );
    diffControls.setBaseline(builtinBaseline);
    diffControls.refresh();
  };

  const reloadPrompt = async () => {
    const data = await fetchWorkAgentPrompt(options.agentId, currentProfile);
    if (!data) {
      sourceLabel.textContent = 'unavailable';
      ta.value = '';
      lastSavedPromptContent = '';
      await reloadBaseline();
      return;
    }
    sourceLabel.textContent =
      data.source === 'override' ? 'Custom override' : 'Built-in default';
    ta.value = data.content;
    lastSavedPromptContent = data.content;
    await reloadBaseline();
  };

  const tabs = buildProfileTabs((profile) => {
    currentProfile = profile;
    void reloadPrompt();
  });

  container.appendChild(tabs.root);

  const meta = el('p', 'settings-field-hint');
  meta.appendChild(document.createTextNode('Prompt source: '));
  meta.appendChild(sourceLabel);
  container.appendChild(meta);
  container.appendChild(ta);

  const diffControls = mountPromptDiffControls(container, {
    getBaseline: () => builtinBaseline,
    getCurrent: () => ta.value,
    showOfflineHint: true,
  });
  ta.addEventListener('input', () => diffControls.refresh());

  const actions = el('div', 'settings-actions');

  const savePromptBtn = el('button', 'settings-action-btn', 'Save prompt');
  savePromptBtn.type = 'button';
  savePromptBtn.addEventListener('click', () => {
    void (async () => {
      const ok = await saveWorkAgentPromptOverride(
        options.agentId,
        currentProfile,
        ta.value,
      );
      setStatus(
        ok ? 'ok' : 'err',
        ok ? `Prompt saved (${currentProfile})` : 'Save failed',
      );
      if (ok) {
        lastSavedPromptContent = ta.value;
        diffControls.refresh();
        await reloadPrompt();
      }
    })();
  });

  const resetBtn = el('button', 'settings-action-btn', 'Reset prompt to built-in');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    const dirty = ta.value !== lastSavedPromptContent;
    if (dirty && !confirm('Discard unsaved edits and remove your override?')) return;
    if (!dirty && !confirm('Remove prompt override for this profile?')) return;
    void (async () => {
      const restored = await resetWorkAgentPromptOverride(
        options.agentId,
        currentProfile,
      );
      if (!restored) {
        setStatus('err', 'No override to reset or server unavailable');
        return;
      }
      ta.value = restored.content;
      lastSavedPromptContent = restored.content;
      sourceLabel.textContent = 'Built-in default';
      await reloadBaseline();
      setStatus('ok', 'Prompt reset to built-in');
    })();
  });

  actions.appendChild(savePromptBtn);
  actions.appendChild(resetBtn);
  container.appendChild(actions);

  void reloadPrompt();
}

/** Work agent structural settings (enable, context budget) without model binding. */
export function mountWorkAgentConfigEditor(
  container: HTMLElement,
  options: WorkAgentEditorOptions,
): void {
  const maxInputTokensInput = document.createElement('input');
  maxInputTokensInput.type = 'number';
  maxInputTokensInput.className = 'settings-select settings-kv-input';
  maxInputTokensInput.min = '1';
  maxInputTokensInput.step = '1';
  maxInputTokensInput.placeholder = 'No cap';
  maxInputTokensInput.value =
    options.initialMaxInputTokens != null ? String(options.initialMaxInputTokens) : '';

  const contextPolicySel = buildContextPolicySelect(options.initialContextPolicy);
  void applyArchiveEmbeddingsGate(contextPolicySel);

  const archiveInitial = {
    ...DEFAULT_ARCHIVE_CONFIG,
    ...(options.initialArchive ?? {}),
  };
  const archiveBlock = mountArchiveTuningBlock(container, archiveInitial);
  (archiveBlock.root as HTMLDetailsElement).open =
    options.initialContextPolicy === 'archive';
  archiveBlock.root.hidden = options.initialContextPolicy !== 'archive';

  const refreshArchiveBanner = mountArchiveDisabledBanner(container, () => {
    refreshArchiveBanner();
  });
  refreshArchiveBanner();

  contextPolicySel.addEventListener('change', () => {
    const isArchive = contextPolicySel.value === 'archive';
    archiveBlock.root.hidden = !isArchive;
    if (!isArchive) {
      clearArchiveDisabledReason();
      refreshArchiveBanner();
    }
  });

  const { row: disabledRow, input: disabledCb } = createSettingsToggleRow('Disabled', {
    checked: !!options.initialDisabled,
  });
  const budgetBlock = el('div', 'settings-model-row');
  budgetBlock.appendChild(el('label', 'settings-field-label', 'Max input tokens'));
  budgetBlock.appendChild(maxInputTokensInput);
  budgetBlock.appendChild(el('label', 'settings-field-label', 'Context policy'));
  budgetBlock.appendChild(contextPolicySel);

  container.appendChild(budgetBlock);
  container.appendChild(archiveBlock.root);
  container.appendChild(disabledRow);

  const saveBtn = el('button', 'settings-action-btn', 'Save agent settings');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const rawCap = maxInputTokensInput.value.trim();
      const maxInputTokens =
        rawCap === '' ? null : Math.max(1, Math.floor(Number(rawCap) || 0));
      const policy = contextPolicySel.value as ContextEnforcementPolicy;
      const patch: Parameters<typeof patchWorkAgentOverride>[1] = {
        disabled: !disabledCb.checked,
        maxInputTokens,
        contextEnforcementPolicy: policy,
      };
      if (policy === 'archive') {
        patch.archive = archiveBlock.readConfig();
      }
      const agent = await patchWorkAgentOverride(options.agentId, patch);
      if (!agent) {
        setStatus('err', 'Could not save work agent settings');
        return;
      }
      if (policy !== 'archive') clearArchiveDisabledReason();
      refreshArchiveBanner();
      setStatus('ok', 'Work agent settings saved');
      options.onModelSaved?.();
    })();
  });
  container.appendChild(saveBtn);
}

/** @deprecated Use mountWorkAgentPromptEditor + mountWorkAgentConfigEditor + Models hub. */
export function mountWorkAgentEditor(
  container: HTMLElement,
  options: WorkAgentEditorOptions,
): void {
  let currentProfile: WorkAgentPromptProfile = 'full';
  let lastSavedPromptContent = '';
  let builtinBaseline = '';
  let binding: ModelBindingState = {
    providerId: options.initialProviderId ?? '',
    modelId: options.initialModelId ?? '',
  };

  const sourceLabel = el('span', 'settings-badge', '…');
  const ta = document.createElement('textarea');
  ta.className = 'settings-part-editor';
  ta.rows = 12;

  const providerSel = document.createElement('select');
  providerSel.className = 'settings-select';
  const modelSel = document.createElement('select');
  modelSel.className = 'settings-select';

  const maxInputTokensInput = document.createElement('input');
  maxInputTokensInput.type = 'number';
  maxInputTokensInput.className = 'settings-select settings-kv-input';
  maxInputTokensInput.min = '1';
  maxInputTokensInput.step = '1';
  maxInputTokensInput.placeholder = 'No cap';
  maxInputTokensInput.value =
    options.initialMaxInputTokens != null ? String(options.initialMaxInputTokens) : '';

  const contextPolicySel = buildContextPolicySelect(options.initialContextPolicy);

  const reloadBaseline = async () => {
    builtinBaseline = await resolveWorkAgentBuiltinBaselineText(
      options.agentId,
      currentProfile,
    );
    diffControls.setBaseline(builtinBaseline);
    diffControls.refresh();
  };

  const reloadPrompt = async () => {
    const data = await fetchWorkAgentPrompt(options.agentId, currentProfile);
    if (!data) {
      sourceLabel.textContent = 'unavailable';
      ta.value = '';
      lastSavedPromptContent = '';
      await reloadBaseline();
      return;
    }
    sourceLabel.textContent =
      data.source === 'override' ? 'Custom override' : 'Built-in default';
    ta.value = data.content;
    lastSavedPromptContent = data.content;
    await reloadBaseline();
  };

  const fillProviders = async () => {
    providerSel.replaceChildren();
    const { providers } = await listProviders();
    for (const p of providers) {
      if (p.enabled === false) continue;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      providerSel.appendChild(opt);
    }
    providerSel.value = binding.providerId || providers[0]?.id || '';
    binding.providerId = providerSel.value;
    await fillModelSelect(modelSel, binding.providerId, binding.modelId);
  };

  providerSel.addEventListener('change', () => {
    binding.providerId = providerSel.value;
    void fillModelSelect(modelSel, binding.providerId, '');
  });
  modelSel.addEventListener('change', () => {
    binding.modelId = modelSel.value;
  });

  const tabs = buildProfileTabs((profile) => {
    currentProfile = profile;
    void reloadPrompt();
  });

  container.appendChild(tabs.root);

  const modelBlock = el('div', 'settings-model-row');
  modelBlock.appendChild(el('label', 'settings-field-label', 'Provider'));
  modelBlock.appendChild(providerSel);
  modelBlock.appendChild(el('label', 'settings-field-label', 'Model'));
  modelBlock.appendChild(modelSel);

  const { row: disabledRow, input: disabledCb } = createSettingsToggleRow('Disabled', {
    checked: !!options.initialDisabled,
  });
  const budgetBlock = el('div', 'settings-model-row');
  budgetBlock.appendChild(el('label', 'settings-field-label', 'Max input tokens'));
  budgetBlock.appendChild(maxInputTokensInput);
  budgetBlock.appendChild(el('label', 'settings-field-label', 'Context policy'));
  budgetBlock.appendChild(contextPolicySel);

  container.appendChild(modelBlock);
  container.appendChild(budgetBlock);
  container.appendChild(disabledRow);

  const meta = el('p', 'settings-field-hint');
  meta.appendChild(document.createTextNode('Prompt source: '));
  meta.appendChild(sourceLabel);
  container.appendChild(meta);
  container.appendChild(ta);

  const diffControls = mountPromptDiffControls(container, {
    getBaseline: () => builtinBaseline,
    getCurrent: () => ta.value,
    showOfflineHint: true,
  });
  ta.addEventListener('input', () => diffControls.refresh());

  const actions = el('div','settings-actions');

  const savePromptBtn = el('button', 'settings-action-btn', 'Save prompt');
  savePromptBtn.type = 'button';
  savePromptBtn.addEventListener('click', () => {
    void (async () => {
      const ok = await saveWorkAgentPromptOverride(
        options.agentId,
        currentProfile,
        ta.value,
      );
      setStatus(
        ok ? 'ok' : 'err',
        ok ? `Prompt saved (${currentProfile})` : 'Save failed',
      );
      if (ok) {
        lastSavedPromptContent = ta.value;
        diffControls.refresh();
        await reloadPrompt();
      }
    })();
  });

  const saveModelBtn = el('button', 'settings-action-btn', 'Save model binding');
  saveModelBtn.type = 'button';
  saveModelBtn.addEventListener('click', () => {
    void (async () => {
      binding.modelId = modelSel.value;
      const rawCap = maxInputTokensInput.value.trim();
      const maxInputTokens =
        rawCap === '' ? null : Math.max(1, Math.floor(Number(rawCap) || 0));
      const agent = await patchWorkAgentOverride(options.agentId, {
        providerId: binding.providerId || null,
        modelId: binding.modelId || null,
        disabled: disabledCb.checked,
        maxInputTokens,
        contextEnforcementPolicy: contextPolicySel.value as ContextEnforcementPolicy,
      });
      if (!agent) {
        setStatus('err', 'Could not save binding');
        return;
      }
      setStatus('ok', 'Model binding saved');
      options.onModelSaved?.();
    })();
  });

  const resetBtn = el('button', 'settings-action-btn', 'Reset prompt to built-in');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    const dirty = ta.value !== lastSavedPromptContent;
    if (dirty && !confirm('Discard unsaved edits and remove your override?')) return;
    if (!dirty && !confirm('Remove prompt override for this profile?')) return;
    void (async () => {
      const restored = await resetWorkAgentPromptOverride(
        options.agentId,
        currentProfile,
      );
      if (!restored) {
        setStatus('err', 'No override to reset or server unavailable');
        return;
      }
      ta.value = restored.content;
      lastSavedPromptContent = restored.content;
      sourceLabel.textContent = 'Built-in default';
      await reloadBaseline();
      setStatus('ok', 'Prompt reset to built-in');
    })();
  });

  actions.appendChild(savePromptBtn);
  actions.appendChild(saveModelBtn);
  actions.appendChild(resetBtn);
  container.appendChild(actions);

  void fillProviders().then(() => reloadPrompt());
}

/** Sub-agent type structural settings (prompt/model live in hubs). */
export function mountSubAgentTypeEditor(
  container: HTMLElement,
  typeId: string,
  label: string,
  initial: {
    enabled: boolean;
    maxConcurrent: number;
    maxInputTokens: number | null;
    contextEnforcementPolicy: ContextEnforcementPolicy;
    summarySchema: string;
  },
  onSaveConfig: (
    patch: Partial<{
      enabled: boolean;
      maxConcurrent: number;
      maxInputTokens: number | null;
      contextEnforcementPolicy: ContextEnforcementPolicy;
      summarySchema: string;
    }>,
  ) => Promise<boolean>,
): void {
  const extra = el('div', 'settings-subagent-extra');
  extra.appendChild(el('p', 'settings-field-hint', `Type id: ${typeId}`));

  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'settings-select';
  maxInput.min = '1';
  maxInput.max = '8';
  maxInput.value = String(initial.maxConcurrent);

  const maxInputTokensInput = document.createElement('input');
  maxInputTokensInput.type = 'number';
  maxInputTokensInput.className = 'settings-select';
  maxInputTokensInput.min = '1';
  maxInputTokensInput.placeholder = 'No cap';
  maxInputTokensInput.value =
    initial.maxInputTokens != null ? String(initial.maxInputTokens) : '';

  const contextPolicySel = buildContextPolicySelect(initial.contextEnforcementPolicy);
  const summarySchemaSel = buildSummarySchemaSelect(initial.summarySchema);

  const { row: enabledRow, input: enabledCb } = createSettingsToggleRow(`${label} enabled`, {
    checked: initial.enabled,
  });

  const maxRow = el('label', 'settings-toggle-row');
  maxRow.appendChild(el('span', '', 'Max concurrent'));
  maxRow.appendChild(maxInput);

  extra.appendChild(enabledRow);
  extra.appendChild(maxRow);
  const budgetRow = el('div', 'settings-model-row');
  budgetRow.appendChild(el('label', 'settings-field-label', 'Max input tokens'));
  budgetRow.appendChild(maxInputTokensInput);
  budgetRow.appendChild(el('label', 'settings-field-label', 'Context policy'));
  budgetRow.appendChild(contextPolicySel);
  budgetRow.appendChild(el('label', 'settings-field-label', 'Summary schema'));
  budgetRow.appendChild(summarySchemaSel);

  extra.appendChild(budgetRow);

  const saveCfgBtn = el('button', 'settings-action-btn', 'Save type settings');
  saveCfgBtn.type = 'button';
  saveCfgBtn.addEventListener('click', () => {
    void (async () => {
      const ok = await onSaveConfig({
        enabled: enabledCb.checked,
        maxConcurrent: Math.max(1, Number(maxInput.value) || 1),
        maxInputTokens:
          maxInputTokensInput.value.trim() === ''
            ? null
            : Math.max(1, Math.floor(Number(maxInputTokensInput.value) || 0)),
        contextEnforcementPolicy: contextPolicySel.value as ContextEnforcementPolicy,
        summarySchema: summarySchemaSel.value,
      });
      setStatus(ok ? 'ok' : 'err', ok ? `${label} settings saved` : 'Save failed');
    })();
  });
  extra.appendChild(saveCfgBtn);

  container.appendChild(extra);
}

/** List of expandable entity cards. */
export function renderEntityEditorList(
  mount: HTMLElement,
  rows: EntityEditorRow[],
  renderBody: (id: string, body: HTMLElement) => void,
): void {
  const list = el('ul', 'settings-entity-list');
  for (const row of rows) {
    const item = el('li', 'settings-entity-list__item');
    const details = document.createElement('details');
    details.className = 'settings-entity-details';

    const summary = document.createElement('summary');
    summary.className = 'settings-entity-list__head';
    if (row.badge) {
      const badge = el('span', 'settings-entity-list__badge', row.badge);
      summary.appendChild(badge);
    }
    summary.append(document.createTextNode(row.label));
    details.appendChild(summary);

    if (row.hint) {
      const hint = el('p', 'settings-field-hint', row.hint);
      details.appendChild(hint);
    }

    const body = el('div','settings-entity-editor-body');
    let loaded = false;
    details.addEventListener('toggle', () => {
      if (!details.open || loaded) return;
      loaded = true;
      renderBody(row.id, body);
    });
    details.appendChild(body);
    item.appendChild(details);
    list.appendChild(item);
  }
  mount.appendChild(list);
}

