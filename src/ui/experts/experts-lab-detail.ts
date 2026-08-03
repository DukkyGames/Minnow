/**

 * Experts' Lab detail pane — tabbed overview, runtime, memory, and chats.

 */



import type { ExpertRuntimeProfile } from '../../chat/experts/types';

import { getBuiltinExpertIds, getExpert, listExperts } from '../../chat/experts/registry';

import { isUserOwnedExpert } from '../../chat/experts/expert-ownership';

import { getExpertsConfigSync, saveExpertRuntimeProfile } from '../../config/experts-config';

import { listModes } from '../../chat/modes/registry';

import { normalizeModeId } from '../../chat/modes/types';

import { getExpertChats, getActiveChat } from '../../state/sessions';

import { getWorkspacePath } from '../../state/workspace';

import {

  acceptMemoryProposal,

  fetchMemoryProposals,

  rejectMemoryProposal,

  type MemoryProposal,

} from '../../synthesis/client';

import {

  clearExpertMemories,

  deleteExpertMemoryPage,

  fetchExpertMemories,

  fetchMemoryEnabled,

  type ExpertMemoryEntry,

} from '../../memory/client';

import { buildExpertSeedValidationContext } from '../../chat/experts/seed-context';

import { resolveExpertChatSeed } from '../../chat/experts/runtime-profile';

import { resolveEffectiveChatModelBinding } from '../../ui/default-model';

import { fillModelSelect, fillProviderSelect } from '../settings-model-binding';

import { decodeModelSelectKey, encodeModelSelectKey } from '../../lib/model-select-key';

import { getEnabledToolDefinitionsForMode } from '../../tools/client';

import { loadToolConfig } from '../../tools/config';

import { isLocalServerAvailable } from '../../tools/config';

import { wrapUntrusted } from '../../lib/untrusted.mjs';

import { appendChatRow, deleteChat } from '../sidebar';
import { appConfirm } from '../app-dialog';

import type { ExpertAccent, ExpertMeta } from '../../chat/experts/types';



export type ExpertsDetailTab = 'overview' | 'runtime' | 'memory' | 'chats';



export interface ExpertsDetailContext {

  selectedExpertId: string;

  detailTab: ExpertsDetailTab;

  setDetailTab: (tab: ExpertsDetailTab) => void;

  expertIcon: (meta: ExpertMeta) => string;

  expertAccent: (meta: ExpertMeta) => ExpertAccent;

  accentClassName: (accent: ExpertAccent) => string;

  hueClassForIndex: (index: number) => string;

  applyAccentToElement: (el: HTMLElement, accent: ExpertAccent) => void;

  promptPreviewForExpert: (expertId: string) => string;

  runtimeModelLabel: (expertId: string) => string;

  onStartChat: () => void;

  onEdit: () => void;

  onDelete: () => void;

  onOpenChat: (chat: import('../../types').Chat) => void;

  onRefresh: () => void;

}



type ToolPolicyMode = 'inherit' | 'allowlist' | 'denylist';



function buildReadonlyField(label: string, value: string): HTMLElement {

  const field = document.createElement('div');

  field.className = 'experts-field';

  const fieldLabel = document.createElement('div');

  fieldLabel.className = 'experts-field-label experts-mono';

  fieldLabel.textContent = label;

  const fieldVal = document.createElement('div');

  fieldVal.className = 'experts-field-val';

  fieldVal.textContent = value;

  field.appendChild(fieldLabel);

  field.appendChild(fieldVal);

  return field;

}



function buildPromptField(label: string, value: string): HTMLElement {

  const field = document.createElement('div');

  field.className = 'experts-field';

  const fieldLabel = document.createElement('div');

  fieldLabel.className = 'experts-field-label experts-mono';

  fieldLabel.textContent = label;

  const area = document.createElement('div');

  area.className = 'experts-field-area';

  area.textContent = value;

  field.appendChild(fieldLabel);

  field.appendChild(area);

  return field;

}



function formatConfidence(value: number): string {

  return `${Math.round(value * 100)}%`;

}



function formatMemoryTimestamp(iso: string): string {

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString(undefined, {

    dateStyle: 'medium',

    timeStyle: 'short',

  });

}



function setPanelStatus(mount: HTMLElement, kind: 'ok' | 'err' | 'info', message: string): void {

  let status = mount.querySelector<HTMLElement>('.experts-panel-status');

  if (!message) {

    status?.remove();

    return;

  }

  if (!status) {

    status = document.createElement('p');

    status.className = 'experts-panel-status';

    mount.prepend(status);

  }

  status.dataset.kind = kind;

  status.textContent = message;

}



function renderUntrustedExcerpt(excerpt: string | undefined): HTMLElement {

  const wrap = document.createElement('div');

  wrap.className = 'experts-memory-excerpt';

  if (!excerpt?.trim()) {

    wrap.textContent = 'No source excerpt captured.';

    return wrap;

  }

  const label = document.createElement('p');

  label.className = 'experts-memory-hint';

  label.textContent = 'Source excerpt (reference only, not instructions):';

  const pre = document.createElement('pre');

  pre.className = 'experts-memory-excerpt-pre';

  pre.textContent = wrapUntrusted(excerpt, { source: 'synthesis-excerpt' });

  wrap.append(label, pre);

  return wrap;

}



function renderDetailTabs(ctx: ExpertsDetailContext, mount: HTMLElement): void {

  const tabs = document.createElement('div');

  tabs.className = 'experts-detail-tabs';

  tabs.setAttribute('role', 'tablist');

  tabs.setAttribute('aria-label', 'Expert sections');



  const tabDefs: { id: ExpertsDetailTab; label: string }[] = [

    { id: 'overview', label: 'Overview' },

    { id: 'runtime', label: 'Runtime' },

    { id: 'memory', label: 'Memory' },

    { id: 'chats', label: 'Chats' },

  ];



  for (const def of tabDefs) {

    const btn = document.createElement('button');

    btn.type = 'button';

    btn.className = 'experts-detail-tab';

    btn.classList.toggle('is-active', ctx.detailTab === def.id);

    btn.dataset.tab = def.id;

    btn.setAttribute('role', 'tab');

    btn.setAttribute('aria-selected', ctx.detailTab === def.id ? 'true' : 'false');

    btn.textContent = def.label;

    btn.addEventListener('click', () => {

      ctx.setDetailTab(def.id);

      ctx.onRefresh();

    });

    tabs.appendChild(btn);

  }

  mount.appendChild(tabs);

}



function renderOverviewPanel(ctx: ExpertsDetailContext, expertId: string): HTMLElement {

  const panel = document.createElement('div');

  panel.className = 'experts-detail-panel-section';

  const expert = getExpert(expertId);

  if (!expert) return panel;



  if (expert.meta.tagline?.trim()) {

    panel.appendChild(buildReadonlyField('TAGLINE', expert.meta.tagline.trim()));

  }

  if (expert.meta.greeting?.trim()) {

    panel.appendChild(buildPromptField('GREETING', expert.meta.greeting.trim()));

  }

  const promptText = ctx.promptPreviewForExpert(expertId);

  if (promptText) {

    panel.appendChild(buildPromptField('SYSTEM PROMPT', promptText));

  }

  panel.appendChild(buildReadonlyField('MODEL', ctx.runtimeModelLabel(expertId)));

  return panel;

}



function initialToolPolicyMode(profile: ExpertRuntimeProfile): ToolPolicyMode {

  if (profile.toolAllowlist?.length) return 'allowlist';

  if (profile.toolDenylist?.length) return 'denylist';

  return 'inherit';

}



function readToolPolicyFromForm(

  mode: ToolPolicyMode,

  toolInputs: Map<string, HTMLInputElement>,

): Pick<ExpertRuntimeProfile, 'toolAllowlist' | 'toolDenylist'> {

  if (mode === 'inherit') {

    return { toolAllowlist: undefined, toolDenylist: undefined };

  }

  const selected: string[] = [];

  for (const [name, input] of toolInputs) {

    if (input.checked) selected.push(name);

  }

  if (mode === 'allowlist') {

    return { toolAllowlist: selected.length ? selected : undefined, toolDenylist: undefined };

  }

  return { toolAllowlist: undefined, toolDenylist: selected.length ? selected : undefined };

}



function buildDraftProfile(

  expertId: string,

  opts: {

    modelOverride: boolean;

    providerSelect: HTMLSelectElement;

    modelSelect: HTMLSelectElement;

    modeSelect: HTMLSelectElement;

    memoryCheck: HTMLInputElement;

    toolPolicyMode: ToolPolicyMode;

    toolInputs: Map<string, HTMLInputElement>;

  },

): ExpertRuntimeProfile {

  const current = getExpertsConfigSync().profiles[expertId] ?? {};

  const draft: ExpertRuntimeProfile = {

    memoryEnabled: opts.memoryCheck.checked,

  };



  const modeVal = opts.modeSelect.value.trim();

  if (modeVal) draft.modeId = normalizeModeId(modeVal);



  if (opts.modelOverride) {

    const decoded = decodeModelSelectKey(opts.modelSelect.value);

    if (decoded) {

      draft.providerId = decoded.providerId;

      draft.modelId = decoded.modelId;

    } else if (opts.modelSelect.value.trim()) {

      draft.modelId = opts.modelSelect.value.trim();

      if (opts.providerSelect.value.trim()) {

        draft.providerId = opts.providerSelect.value.trim();

      }

    }

  }



  const toolPolicy = readToolPolicyFromForm(opts.toolPolicyMode, opts.toolInputs);

  if (toolPolicy.toolAllowlist?.length) draft.toolAllowlist = toolPolicy.toolAllowlist;

  if (toolPolicy.toolDenylist?.length) draft.toolDenylist = toolPolicy.toolDenylist;



  if (!draft.modeId && current.modeId) delete draft.modeId;

  return draft;

}



function renderEffectiveRuntimeSummary(expertId: string, draft: ExpertRuntimeProfile): HTMLElement {

  const box = document.createElement('div');

  box.className = 'experts-runtime-summary';



  const active = getActiveChat();

  const binding = resolveEffectiveChatModelBinding(active);

  const source = {

    providerId: binding.providerId,

    modelId: binding.modelId,

    modeId: normalizeModeId(active.modeId),

    workspacePath: getWorkspacePath(),

  };



  const config = getExpertsConfigSync();

  const mergedProfiles = { ...config.profiles, [expertId]: draft };

  const validation = buildExpertSeedValidationContext();

  const seed = resolveExpertChatSeed(expertId, source, { ...config, profiles: mergedProfiles }, validation);



  const title = document.createElement('div');

  title.className = 'experts-field-label experts-mono';

  title.textContent = 'EFFECTIVE RUNTIME (NEW CHATS)';

  box.appendChild(title);



  if ('error' in seed) {

    const err = document.createElement('p');

    err.className = 'experts-runtime-warning';

    err.textContent = seed.error;

    box.appendChild(err);

    return box;

  }



  const snap = seed.runtimeSnapshot;

  const lines = [

    `Model: ${snap.providerId ? `${snap.providerId} / ` : ''}${snap.modelId || '(none)'}`,

    `Mode: ${snap.modeId}`,

    `Tools: ${snap.enabledToolNames.length} enabled`,

    `Memory: ${snap.memoryEnabled ? 'on' : 'off'}`,

  ];

  const list = document.createElement('ul');

  list.className = 'experts-runtime-summary-list';

  for (const line of lines) {

    const li = document.createElement('li');

    li.textContent = line;

    list.appendChild(li);

  }

  box.appendChild(list);



  for (const warning of snap.warnings) {

    const warn = document.createElement('p');

    warn.className = 'experts-runtime-warning';

    warn.textContent = warning;

    box.appendChild(warn);

  }



  return box;

}



async function renderRuntimePanel(ctx: ExpertsDetailContext, expertId: string): Promise<HTMLElement> {

  const panel = document.createElement('div');

  panel.className = 'experts-detail-panel-section';

  loadToolConfig();



  const config = getExpertsConfigSync();

  const profile = config.profiles[expertId] ?? {};



  panel.appendChild(buildReadonlyField('INHERITED MODEL', ctx.runtimeModelLabel(expertId)));



  const modelOverrideRow = document.createElement('label');

  modelOverrideRow.className = 'experts-runtime-toggle';

  const modelOverrideCheck = document.createElement('input');

  modelOverrideCheck.type = 'checkbox';

  modelOverrideCheck.checked = Boolean(profile.providerId || profile.modelId);

  modelOverrideRow.append(modelOverrideCheck, ' Override provider and model');

  panel.appendChild(modelOverrideRow);



  const modelFields = document.createElement('div');

  modelFields.className = 'experts-runtime-model-fields';

  modelFields.hidden = !modelOverrideCheck.checked;



  const providerRow = document.createElement('div');

  providerRow.className = 'experts-field';

  const providerLabel = document.createElement('div');

  providerLabel.className = 'experts-field-label experts-mono';

  providerLabel.textContent = 'PROVIDER';

  const providerSelect = document.createElement('select');

  providerSelect.className = 'experts-edit-input';

  providerRow.append(providerLabel, providerSelect);



  const modelRow = document.createElement('div');

  modelRow.className = 'experts-field';

  const modelLabel = document.createElement('div');

  modelLabel.className = 'experts-field-label experts-mono';

  modelLabel.textContent = 'MODEL';

  const modelSelect = document.createElement('select');

  modelSelect.className = 'experts-edit-input';

  modelRow.append(modelLabel, modelSelect);

  modelFields.append(providerRow, modelRow);

  panel.appendChild(modelFields);



  const modeRow = document.createElement('div');

  modeRow.className = 'experts-field';

  const modeLabel = document.createElement('div');

  modeLabel.className = 'experts-field-label experts-mono';

  modeLabel.textContent = 'MODE OVERRIDE';

  const modeSelect = document.createElement('select');

  modeSelect.className = 'experts-edit-input';

  const inheritOpt = document.createElement('option');

  inheritOpt.value = '';

  inheritOpt.textContent = 'Inherit from source chat';

  modeSelect.appendChild(inheritOpt);

  for (const mode of listModes()) {

    const opt = document.createElement('option');

    opt.value = mode.id;

    opt.textContent = mode.label;

    if (profile.modeId === mode.id) opt.selected = true;

    modeSelect.appendChild(opt);

  }

  modeRow.append(modeLabel, modeSelect);

  panel.appendChild(modeRow);



  const memoryRow = document.createElement('label');

  memoryRow.className = 'experts-runtime-toggle';

  const memoryCheck = document.createElement('input');

  memoryCheck.type = 'checkbox';

  memoryCheck.checked = profile.memoryEnabled !== false;

  memoryRow.append(memoryCheck, ' Expert long-term memory');

  panel.appendChild(memoryRow);



  const toolPolicyRow = document.createElement('div');

  toolPolicyRow.className = 'experts-field';

  const toolPolicyLabel = document.createElement('div');

  toolPolicyLabel.className = 'experts-field-label experts-mono';

  toolPolicyLabel.textContent = 'TOOL POLICY';

  const toolPolicySelect = document.createElement('select');

  toolPolicySelect.className = 'experts-edit-input';

  const policyOptions: { value: ToolPolicyMode; label: string }[] = [

    { value: 'inherit', label: 'Inherit all mode-allowed tools' },

    { value: 'allowlist', label: 'Allowlist only selected tools' },

    { value: 'denylist', label: 'Denylist selected tools' },

  ];

  const initialPolicy = initialToolPolicyMode(profile);

  for (const optDef of policyOptions) {

    const opt = document.createElement('option');

    opt.value = optDef.value;

    opt.textContent = optDef.label;

    if (optDef.value === initialPolicy) opt.selected = true;

    toolPolicySelect.appendChild(opt);

  }

  toolPolicyRow.append(toolPolicyLabel, toolPolicySelect);

  panel.appendChild(toolPolicyRow);



  const toolListMount = document.createElement('div');

  toolListMount.className = 'experts-tool-list';

  panel.appendChild(toolListMount);



  const toolInputs = new Map<string, HTMLInputElement>();

  const summaryMount = document.createElement('div');

  panel.appendChild(summaryMount);



  const refreshToolList = (): void => {

    toolListMount.replaceChildren();

    toolInputs.clear();

    const policy = toolPolicySelect.value as ToolPolicyMode;

    toolListMount.hidden = policy === 'inherit';



    const modeId = profile.modeId ?? normalizeModeId(getActiveChat().modeId);

    const effectiveMode = modeSelect.value.trim()

      ? normalizeModeId(modeSelect.value)

      : modeId;

    const defs = getEnabledToolDefinitionsForMode(effectiveMode);

    const allowSet = new Set(profile.toolAllowlist ?? []);

    const denySet = new Set(profile.toolDenylist ?? []);



    if (policy === 'inherit') {

      refreshSummary();

      return;

    }



    const hint = document.createElement('p');

    hint.className = 'experts-memory-hint';

    hint.textContent =

      policy === 'allowlist'

        ? 'Only checked tools are available to this expert.'

        : 'Checked tools are removed from the mode allowlist.';

    toolListMount.appendChild(hint);



    for (const def of defs) {

      const name = def.function.name;

      const row = document.createElement('label');

      row.className = 'experts-tool-row';

      const check = document.createElement('input');

      check.type = 'checkbox';

      check.checked =

        policy === 'allowlist' ? allowSet.has(name) : denySet.has(name);

      const label = document.createElement('span');

      label.textContent = name;

      row.append(check, label);

      toolListMount.appendChild(row);

      toolInputs.set(name, check);

      check.addEventListener('change', refreshSummary);

    }

    refreshSummary();

  };



  const refreshSummary = (): void => {

    summaryMount.replaceChildren();

    const draft = buildDraftProfile(expertId, {

      modelOverride: modelOverrideCheck.checked,

      providerSelect,

      modelSelect,

      modeSelect,

      memoryCheck,

      toolPolicyMode: toolPolicySelect.value as ToolPolicyMode,

      toolInputs,

    });

    summaryMount.appendChild(renderEffectiveRuntimeSummary(expertId, draft));

  };



  modelOverrideCheck.addEventListener('change', () => {

    modelFields.hidden = !modelOverrideCheck.checked;

    refreshSummary();

  });

  modeSelect.addEventListener('change', () => {

    refreshToolList();

  });

  toolPolicySelect.addEventListener('change', refreshToolList);

  memoryCheck.addEventListener('change', refreshSummary);



  const initialProvider = profile.providerId ?? '';

  const initialModel = profile.modelId ?? '';

  await fillProviderSelect(providerSelect, initialProvider, { includeEmptyOption: true });

  await fillModelSelect(modelSelect, providerSelect.value || initialProvider, initialModel, {

    includeEmptyOption: true,

  });

  providerSelect.addEventListener('change', () => {

    void fillModelSelect(modelSelect, providerSelect.value, '', { includeEmptyOption: true }).then(

      refreshSummary,

    );

  });

  modelSelect.addEventListener('change', refreshSummary);



  if (profile.providerId && profile.modelId) {

    const key = encodeModelSelectKey(profile.providerId, profile.modelId);

    if ([...modelSelect.options].some((o) => o.value === key)) {

      modelSelect.value = key;

    } else {

      modelSelect.value = profile.modelId;

    }

  }



  refreshToolList();



  const saveBtn = document.createElement('button');

  saveBtn.type = 'button';

  saveBtn.className = 'experts-btn-ghost';

  saveBtn.textContent = 'Save runtime';

  saveBtn.addEventListener('click', () => {

    const draft = buildDraftProfile(expertId, {

      modelOverride: modelOverrideCheck.checked,

      providerSelect,

      modelSelect,

      modeSelect,

      memoryCheck,

      toolPolicyMode: toolPolicySelect.value as ToolPolicyMode,

      toolInputs,

    });

    if (!modelOverrideCheck.checked) {

      delete draft.providerId;

      delete draft.modelId;

    }

    void saveExpertRuntimeProfile(expertId, draft).then(() => ctx.onRefresh());

  });

  panel.appendChild(saveBtn);



  return panel;

}



function renderMemoryProposalCard(

  proposal: MemoryProposal,

  onChange: () => void,

  setStatus: (kind: 'ok' | 'err' | 'info', message: string) => void,

): HTMLElement {

  const card = document.createElement('article');

  card.className = 'experts-memory-card';



  const head = document.createElement('header');

  head.className = 'experts-memory-card-head';

  const title = document.createElement('h4');

  title.className = 'experts-memory-card-title';

  title.textContent = proposal.title;

  const meta = document.createElement('p');

  meta.className = 'experts-memory-hint';

  meta.textContent = `${proposal.category} · confidence ${formatConfidence(proposal.confidence)}`;

  head.append(title, meta);



  const titleInput = document.createElement('input');

  titleInput.type = 'text';

  titleInput.className = 'experts-edit-input';

  titleInput.value = proposal.title;

  titleInput.setAttribute('aria-label', 'Proposal title');



  const bodyInput = document.createElement('textarea');

  bodyInput.className = 'experts-brief-input experts-memory-body-input';

  bodyInput.rows = 4;

  bodyInput.value = proposal.body;

  bodyInput.setAttribute('aria-label', 'Proposal body');



  const rationale = document.createElement('p');

  rationale.className = 'experts-memory-hint';

  rationale.textContent = proposal.rationale || 'No rationale provided.';



  if (proposal.sourceChatId) {

    const source = document.createElement('p');

    source.className = 'experts-memory-hint';

    source.textContent = `From chat ${proposal.sourceChatId}`;

    card.appendChild(source);

  }



  const actions = document.createElement('div');

  actions.className = 'experts-memory-actions';

  const acceptBtn = document.createElement('button');

  acceptBtn.type = 'button';

  acceptBtn.className = 'experts-btn-primary experts-memory-accept';

  acceptBtn.textContent = 'Accept';

  const rejectBtn = document.createElement('button');

  rejectBtn.type = 'button';

  rejectBtn.className = 'experts-btn-ghost';

  rejectBtn.textContent = 'Reject';



  acceptBtn.addEventListener('click', () => {

    void (async () => {

      setStatus('info', 'Saving memory…');

      const ok = await acceptMemoryProposal(proposal.id, {

        title: titleInput.value.trim(),

        body: bodyInput.value.trim(),

        tags: proposal.tags,

      });

      if (!ok) {

        setStatus('err', 'Could not accept memory proposal. Is Minnow running?');

        return;

      }

      setStatus('ok', 'Memory saved');

      onChange();

    })();

  });



  rejectBtn.addEventListener('click', () => {

    void (async () => {

      const ok = await rejectMemoryProposal(proposal.id);

      if (!ok) {

        setStatus('err', 'Could not reject proposal.');

        return;

      }

      setStatus('ok', 'Proposal rejected');

      onChange();

    })();

  });



  actions.append(acceptBtn, rejectBtn);

  card.append(

    head,

    renderUntrustedExcerpt(proposal.sourceExcerpt),

    rationale,

    titleInput,

    bodyInput,

    actions,

  );

  return card;

}



function renderSavedMemoryCard(

  entry: ExpertMemoryEntry,

  onChange: () => void,

  setStatus: (kind: 'ok' | 'err' | 'info', message: string) => void,

): HTMLElement {

  const card = document.createElement('article');

  card.className = 'experts-memory-card';



  const head = document.createElement('header');

  head.className = 'experts-memory-card-head';

  const title = document.createElement('h4');

  title.className = 'experts-memory-card-title';

  title.textContent = entry.title || 'Untitled';

  const updated = document.createElement('p');

  updated.className = 'experts-memory-hint';

  updated.textContent = `Updated ${formatMemoryTimestamp(entry.updatedAt)}`;

  head.append(title, updated);



  const body = document.createElement('p');

  body.className = 'experts-memory-body-preview';

  body.textContent = entry.body?.trim()

    ? entry.body.slice(0, 280)

    : 'No body stored.';



  const deleteBtn = document.createElement('button');

  deleteBtn.type = 'button';

  deleteBtn.className = 'experts-btn-ghost is-danger';

  deleteBtn.textContent = 'Delete';

  deleteBtn.addEventListener('click', () => {

    void (async () => {

      const label = entry.title || 'this memory';

      if (
        !(await appConfirm(`Delete "${label}"? This cannot be undone.`, {
          confirmLabel: 'Delete',
          danger: true,
        }))
      ) {
        return;
      }

      const ok = await deleteExpertMemoryPage(entry.path);

      if (!ok) {

        setStatus('err', 'Could not delete memory.');

        return;

      }

      setStatus('ok', 'Memory deleted');

      onChange();

    })();

  });



  card.append(head, body, deleteBtn);

  return card;

}



async function renderMemoryPanel(ctx: ExpertsDetailContext, expertId: string): Promise<HTMLElement> {

  const panel = document.createElement('div');

  panel.className = 'experts-detail-panel-section';



  const setStatus = (kind: 'ok' | 'err' | 'info', message: string): void => {

    setPanelStatus(panel, kind, message);

  };



  const reload = (): void => {

    ctx.onRefresh();

  };



  if (!isLocalServerAvailable()) {

    const offline = document.createElement('p');

    offline.className = 'experts-chat-empty';

    offline.textContent = 'Open Minnow to review expert memory.';

    panel.appendChild(offline);

    return panel;

  }



  const memoryEnabled = await fetchMemoryEnabled();

  if (!memoryEnabled) {

    const disabled = document.createElement('p');

    disabled.className = 'experts-chat-empty';

    disabled.textContent = 'Memory is disabled in Settings. Enable it to use expert long-term memory.';

    panel.appendChild(disabled);

    return panel;

  }



  const [pending, saved] = await Promise.all([

    fetchMemoryProposals('pending', expertId),

    fetchExpertMemories(expertId, true),

  ]);



  const pendingSection = document.createElement('section');

  pendingSection.className = 'experts-memory-section';

  const pendingLabel = document.createElement('div');

  pendingLabel.className = 'experts-field-label experts-mono';

  pendingLabel.textContent = `PENDING (${pending?.length ?? 0})`;

  pendingSection.appendChild(pendingLabel);



  if (!pending?.length) {

    const empty = document.createElement('p');

    empty.className = 'experts-chat-empty';

    empty.textContent = 'No memory suggestions awaiting review.';

    pendingSection.appendChild(empty);

  } else {

    for (const row of pending) {

      pendingSection.appendChild(renderMemoryProposalCard(row, reload, setStatus));

    }

  }

  panel.appendChild(pendingSection);



  const savedSection = document.createElement('section');

  savedSection.className = 'experts-memory-section';

  const savedHead = document.createElement('div');

  savedHead.className = 'experts-memory-section-head';

  const savedLabel = document.createElement('div');

  savedLabel.className = 'experts-field-label experts-mono';

  savedLabel.textContent = `SAVED (${saved?.length ?? 0})`;

  savedHead.appendChild(savedLabel);



  if (saved?.length) {

    const clearBtn = document.createElement('button');

    clearBtn.type = 'button';

    clearBtn.className = 'experts-btn-ghost is-danger';

    clearBtn.textContent = 'Clear all';

    clearBtn.addEventListener('click', () => {

      void (async () => {

        if (
          !(await appConfirm(
            `Clear all ${saved.length} saved memories for this expert? This cannot be undone.`,
            { confirmLabel: 'Clear all', danger: true },
          ))
        ) {

          return;

        }

        const removed = await clearExpertMemories(expertId);

        if (removed == null) {

          setStatus('err', 'Could not clear expert memories.');

          return;

        }

        setStatus('ok', `Cleared ${removed} memor${removed === 1 ? 'y' : 'ies'}`);

        reload();

      })();

    });

    savedHead.appendChild(clearBtn);

  }

  savedSection.appendChild(savedHead);



  if (!saved?.length) {

    const empty = document.createElement('p');

    empty.className = 'experts-chat-empty';

    empty.textContent = 'No accepted memories yet. They appear here after you accept proposals.';

    savedSection.appendChild(empty);

  } else {

    for (const row of saved) {

      savedSection.appendChild(renderSavedMemoryCard(row, reload, setStatus));

    }

  }

  panel.appendChild(savedSection);



  return panel;

}



function renderChatsPanel(ctx: ExpertsDetailContext, expertId: string): HTMLElement {

  const panel = document.createElement('div');

  panel.className = 'experts-detail-panel-section';

  const chatList = document.createElement('div');

  chatList.className = 'experts-chat-list chat-list';

  chatList.setAttribute('role', 'list');

  const chats = getExpertChats(expertId);

  if (!chats.length) {

    const empty = document.createElement('p');

    empty.className = 'experts-chat-empty';

    empty.textContent = 'No chats yet. Start a chat to begin.';

    chatList.appendChild(empty);

  } else {

    for (const chat of chats) {

      appendChatRow(chatList, chat, null, {

        draggable: false,

        onActivate: (c) => ctx.onOpenChat(c),

        onDelete: (c) => {
          void deleteChat(c.id).then(() => ctx.onRefresh());
        },

      });

    }

  }

  panel.appendChild(chatList);

  return panel;

}



/** Render the tabbed expert detail column into #expertsDetailMount. */

export function renderExpertDetailTabbed(ctx: ExpertsDetailContext): void {

  const mount = document.getElementById('expertsDetailMount');

  if (!mount) return;

  mount.replaceChildren();



  const expertId = ctx.selectedExpertId;

  const expert = getExpert(expertId);

  if (!expert) return;



  const builtinIds = getBuiltinExpertIds();

  const accent = ctx.expertAccent(expert.meta);

  const experts = listExperts();

  const index = experts.findIndex((e) => e.meta.id === expertId);



  const head = document.createElement('div');

  head.className = 'experts-detail-head';

  const ava = document.createElement('span');

  ava.className = `experts-card-ava lg ${ctx.hueClassForIndex(Math.max(index, 0))} ${ctx.accentClassName(accent)}`;

  ava.textContent = ctx.expertIcon(expert.meta);

  ava.setAttribute('aria-hidden', 'true');

  ctx.applyAccentToElement(ava, accent);

  const headCopy = document.createElement('div');

  const title = document.createElement('h3');

  title.textContent = expert.meta.label;

  const subtitle = document.createElement('p');

  subtitle.textContent =

    expert.meta.description ?? expert.meta.tagline ?? 'Focused specialist persona';

  headCopy.appendChild(title);

  headCopy.appendChild(subtitle);

  head.appendChild(ava);

  head.appendChild(headCopy);

  mount.appendChild(head);



  renderDetailTabs(ctx, mount);



  const panelMount = document.createElement('div');

  panelMount.className = 'experts-detail-tab-panel';

  mount.appendChild(panelMount);



  if (ctx.detailTab === 'overview') {

    panelMount.appendChild(renderOverviewPanel(ctx, expertId));

  } else if (ctx.detailTab === 'runtime') {

    void renderRuntimePanel(ctx, expertId).then((el) => panelMount.appendChild(el));

  } else if (ctx.detailTab === 'memory') {

    void renderMemoryPanel(ctx, expertId).then((el) => panelMount.appendChild(el));

  } else {

    panelMount.appendChild(renderChatsPanel(ctx, expertId));

  }



  const actions = document.createElement('div');

  actions.className = 'experts-detail-actions';

  const startBtn = document.createElement('button');

  startBtn.type = 'button';

  startBtn.className = 'experts-btn-primary';

  startBtn.textContent = 'Start chat';

  startBtn.addEventListener('click', ctx.onStartChat);

  actions.appendChild(startBtn);



  if (isUserOwnedExpert(expert, builtinIds)) {

    const editBtn = document.createElement('button');

    editBtn.type = 'button';

    editBtn.className = 'experts-btn-ghost';

    editBtn.textContent = 'Edit';

    editBtn.addEventListener('click', ctx.onEdit);

    const deleteBtn = document.createElement('button');

    deleteBtn.type = 'button';

    deleteBtn.className = 'experts-btn-ghost is-danger';

    deleteBtn.textContent = 'Delete';

    deleteBtn.addEventListener('click', ctx.onDelete);

    actions.appendChild(editBtn);

    actions.appendChild(deleteBtn);

  }

  mount.appendChild(actions);

}


