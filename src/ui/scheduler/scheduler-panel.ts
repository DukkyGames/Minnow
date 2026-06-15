/**
 * Scheduler job list + editor panel (shared by the Scheduler app).
 */

import { getMode, listModes } from '../../chat/modes/registry';
import {
  createSchedulerJob,
  deleteSchedulerJob,
  fetchSchedulerDefaultWorkspace,
  fetchSchedulerJobs,
  fetchSchedulerRuns,
  runSchedulerJobNow,
  updateSchedulerJob,
  type ScheduledJob,
  type SchedulerRun,
} from '../../scheduler/client';
import { describeSchedule, uiToSchedule, validateScheduleUi } from '../../scheduler/schedule-display';
import { populateMultiProviderModelSelect } from '../../api/models';
import { formatModelLabel } from '../../lib/format-model-label';
import { decodeModelSelectKey } from '../../lib/model-select-key';
import { listProviders } from '../../providers/store';
import {
  mountAuxiliaryModelSelectCombobox,
  syncAuxiliaryModelSelectCombobox,
} from '../model-select-picker';
import { createSettingsToggleRow } from '../settings-switch';
import { isLocalServerAvailable } from '../../tools/config';
import { openWorkspaceFolderPicker } from '../workspace-folder-picker';
import { mountScheduleField } from './schedule-field';
import {
  formatSchedulerRunSummary,
  resolveSchedulerRunChatId,
} from '../../scheduler/run-summary';
import { findChatById, loadSessionsFromStorage, sessionState } from '../../state/sessions';
import { setWorkspacePath } from '../../config/workspace-api';
import { getWorkspacePath, setWorkspaceFromServer } from '../../state/workspace';
import { launchApp } from '../../os/router';
import { switchChat, applyWorkspaceScopedSession } from '../sidebar';

export interface SchedulerPanelOptions {
  onStatus?: (state: 'ok' | 'err', message: string) => void;
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

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function modeLabel(modeId: string): string {
  try {
    return getMode(modeId as Parameters<typeof getMode>[0]).label;
  } catch {
    return modeId;
  }
}

function truncateText(text: string, max = 96): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Folder basename for workspace display. */
function workspaceBasename(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? absPath;
}

function formatJobWorkspaceLabel(
  job: Pick<ScheduledJob, 'workspacePath'>,
  defaultWorkspacePath: string,
  defaultLabel: string,
): string {
  const custom = job.workspacePath?.trim();
  if (!custom) {
    return `${defaultLabel} (default)`;
  }
  return workspaceBasename(custom);
}

/** Human-readable model label for job list rows. */
function formatJobModelLabel(
  job: Pick<ScheduledJob, 'providerId' | 'modelId'>,
  providerLabelById: Map<string, string>,
): string {
  const modelId = job.modelId?.trim();
  if (!modelId) {
    return 'Menubar default';
  }
  const { optionText } = formatModelLabel({ id: modelId });
  const providerId = job.providerId?.trim();
  const providerLabel = providerId ? providerLabelById.get(providerId) ?? providerId : '';
  return providerLabel ? `${optionText} — ${providerLabel}` : optionText;
}

const EMPTY_FORM: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt' | 'running'> = {
  label: '',
  enabled: true,
  schedule: { kind: 'interval', value: '5m' },
  prompt: '',
  modeId: 'build',
  channels: ['in_app'],
};

/** Inline clock icon for the uptime notice. */
function createNoticeIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('scheduler-notice__icon');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '1.75');
  const hand = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hand.setAttribute('d', 'M12 7v5l3 2');
  hand.setAttribute('fill', 'none');
  hand.setAttribute('stroke', 'currentColor');
  hand.setAttribute('stroke-width', '1.75');
  hand.setAttribute('stroke-linecap', 'round');
  hand.setAttribute('stroke-linejoin', 'round');
  svg.append(circle, hand);
  return svg;
}

/** Render scheduler CRUD UI into the supplied mount element. */
export async function renderSchedulerPanel(
  mount: HTMLElement,
  options: SchedulerPanelOptions = {},
): Promise<void> {
  const notify = (state: 'ok' | 'err', message: string) => {
    options.onStatus?.(state, message);
  };

  mount.replaceChildren();
  mount.classList.add('scheduler-panel-mount');

  const panel = el('div', 'scheduler-panel');
  mount.appendChild(panel);

  const notice = el('aside', 'scheduler-notice');
  notice.setAttribute('role', 'note');
  notice.appendChild(createNoticeIcon());
  notice.appendChild(
    el(
      'p',
      'scheduler-notice__text',
      'Jobs run only while Minnow is open (npm start or the desktop app). Stopping the server pauses every schedule.',
    ),
  );
  panel.appendChild(notice);

  if (!isLocalServerAvailable()) {
    const offline = el('div', 'scheduler-offline');
    offline.appendChild(
      el('p', 'scheduler-offline__title', 'Tool server offline'),
    );
    offline.appendChild(
      el(
        'p',
        'scheduler-offline__hint',
        'Run npm start to create and manage scheduled jobs.',
      ),
    );
    panel.appendChild(offline);
    return;
  }

  const head = el('div', 'scheduler-panel-head');
  const stats = el('div', 'scheduler-stats');

  const jobCountStat = el('div', 'scheduler-stat');
  jobCountStat.appendChild(el('span', 'scheduler-stat__label', 'Jobs'));
  const jobCountValue = el('span', 'scheduler-stat__value', '0');
  jobCountStat.appendChild(jobCountValue);

  const activeCountStat = el('div', 'scheduler-stat');
  activeCountStat.appendChild(el('span', 'scheduler-stat__label', 'Enabled'));
  const activeCountValue = el('span', 'scheduler-stat__value', '0');
  activeCountStat.appendChild(activeCountValue);

  stats.append(jobCountStat, activeCountStat);
  head.appendChild(stats);

  const addBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'New job');
  addBtn.type = 'button';
  head.appendChild(addBtn);
  panel.appendChild(head);

  const main = el('div', 'scheduler-panel-main');
  panel.appendChild(main);

  const list = el('div', 'scheduler-jobs');
  list.setAttribute('role', 'list');
  main.appendChild(list);

  const formPanel = el('section', 'scheduler-editor hidden');
  formPanel.setAttribute('aria-label', 'Job editor');
  main.appendChild(formPanel);

  const historyPanel = el('section', 'scheduler-history hidden');
  historyPanel.setAttribute('aria-label', 'Run history');
  panel.appendChild(historyPanel);

  let editingId: string | null = null;
  let selectedHistoryJobId: string | null = null;
  const formState = { ...EMPTY_FORM };
  let defaultWorkspacePath = '';
  let defaultWorkspaceLabel = 'Scheduler';
  const providerLabelById = new Map<string, string>();

  try {
    const defaultWorkspace = await fetchSchedulerDefaultWorkspace();
    defaultWorkspacePath = defaultWorkspace.path;
    defaultWorkspaceLabel = defaultWorkspace.label || 'Scheduler';
  } catch {
    /* offline guard above should prevent this; keep form usable */
  }

  try {
    const { providers } = await listProviders();
    for (const provider of providers) {
      providerLabelById.set(provider.id, provider.label || provider.id);
    }
  } catch {
    /* model list labels degrade to ids when providers are unreachable */
  }

  function setEditorOpen(open: boolean): void {
    formPanel.classList.toggle('hidden', !open);
    main.classList.toggle('has-editor', open);
  }

  function openCreateForm(): void {
    editingId = null;
    formPanel.dataset.create = '1';
    Object.assign(formState, EMPTY_FORM);
    setEditorOpen(true);
    renderForm();
    formPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderForm(): void {
    formPanel.replaceChildren();

    const editorHead = el('div', 'scheduler-editor__head');
    editorHead.appendChild(
      el('h3', 'scheduler-editor__title', editingId ? 'Edit job' : 'New job'),
    );
    formPanel.appendChild(editorHead);

    const fields = el('div', 'scheduler-editor__fields');

    const labelField = el('label', 'scheduler-field');
    labelField.appendChild(el('span', 'scheduler-field__label', 'Label'));
    const labelInput = el('input', 'scheduler-input') as HTMLInputElement;
    labelInput.type = 'text';
    labelInput.placeholder = 'Morning standup summary';
    labelInput.value = formState.label;
    labelInput.addEventListener('input', () => {
      formState.label = labelInput.value;
    });
    labelField.appendChild(labelInput);
    fields.appendChild(labelField);

    const scheduleField = el('div', 'scheduler-field');
    scheduleField.appendChild(el('span', 'scheduler-field__label', 'Schedule'));
    const scheduleMount = mountScheduleField(
      scheduleField,
      formState.schedule,
      (schedule) => {
        formState.schedule = schedule;
      },
    );
    fields.appendChild(scheduleField);

    const promptField = el('label', 'scheduler-field');
    promptField.appendChild(el('span', 'scheduler-field__label', 'Prompt'));
    const promptInput = el('textarea', 'scheduler-textarea') as HTMLTextAreaElement;
    promptInput.rows = 5;
    promptInput.placeholder = 'What should the agent do on each run?';
    promptInput.value = formState.prompt;
    promptInput.addEventListener('input', () => {
      formState.prompt = promptInput.value;
    });
    promptField.appendChild(promptInput);
    fields.appendChild(promptField);

    const modeField = el('label', 'scheduler-field');
    modeField.appendChild(el('span', 'scheduler-field__label', 'Mode'));
    const modeSelect = el('select', 'settings-select') as HTMLSelectElement;
    for (const mode of listModes()) {
      const opt = el('option', undefined, mode.label) as HTMLOptionElement;
      opt.value = mode.id;
      if (formState.modeId === mode.id) opt.selected = true;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener('change', () => {
      formState.modeId = modeSelect.value;
    });
    modeField.appendChild(modeSelect);
    fields.appendChild(modeField);

    const modelField = el('div', 'scheduler-field scheduler-model-field');
    modelField.appendChild(el('span', 'scheduler-field__label', 'Model'));
    const modelSelect = el('select', 'settings-select scheduler-model-select') as HTMLSelectElement;
    modelSelect.id = 'schedulerJobModel';
    modelSelect.innerHTML = '<option value="">Loading models…</option>';
    modelField.appendChild(modelSelect);

    const modelHint = el(
      'span',
      'scheduler-field__hint',
      formState.modelId?.trim()
        ? formatJobModelLabel(formState, providerLabelById)
        : 'Uses the model selected in the menubar when this job runs.',
    );
    modelField.appendChild(modelHint);
    fields.appendChild(modelField);

    mountAuxiliaryModelSelectCombobox(modelSelect);
    modelSelect.addEventListener('change', () => {
      const decoded = decodeModelSelectKey(modelSelect.value);
      if (decoded) {
        formState.providerId = decoded.providerId;
        formState.modelId = decoded.modelId;
        modelHint.textContent = formatJobModelLabel(formState, providerLabelById);
      } else {
        formState.providerId = undefined;
        formState.modelId = undefined;
        modelHint.textContent = 'Uses the model selected in the menubar when this job runs.';
      }
    });
    void (async () => {
      await populateMultiProviderModelSelect(modelSelect, {
        selectedProviderId: formState.providerId,
        selectedModelId: formState.modelId,
        includeEmptyOption: true,
        emptyLabel: '(use menubar default)',
      });
      syncAuxiliaryModelSelectCombobox(modelSelect);
    })();

    const workspaceField = el('div', 'scheduler-field');
    workspaceField.appendChild(el('span', 'scheduler-field__label', 'Workspace'));
    const workspaceRow = el('div', 'scheduler-workspace-row');

    const workspacePathInput = el('input', 'scheduler-input scheduler-workspace-path') as HTMLInputElement;
    workspacePathInput.type = 'text';
    workspacePathInput.readOnly = true;
    workspacePathInput.placeholder = defaultWorkspacePath
      ? `${defaultWorkspaceLabel} (default)`
      : 'Scheduler (default)';
    const customWorkspace = formState.workspacePath?.trim();
    workspacePathInput.value = customWorkspace ?? '';
    workspacePathInput.title = customWorkspace || defaultWorkspacePath || workspacePathInput.placeholder;

    const workspaceSummary = el(
      'span',
      'scheduler-workspace-summary',
      customWorkspace
        ? workspaceBasename(customWorkspace)
        : `${defaultWorkspaceLabel} (default)`,
    );

    const browseBtn = el('button', 'settings-inline-btn', 'Browse…');
    browseBtn.type = 'button';
    browseBtn.addEventListener('click', () => {
      void (async () => {
        const result = await openWorkspaceFolderPicker({
          initialPath: customWorkspace || defaultWorkspacePath || undefined,
        });
        if (result.cancelled || !result.path) return;
        formState.workspacePath = result.path;
        workspacePathInput.value = result.path;
        workspacePathInput.title = result.path;
        workspaceSummary.textContent = workspaceBasename(result.path);
        useDefaultBtn.hidden = false;
      })();
    });

    const useDefaultBtn = el('button', 'settings-inline-btn', 'Use default');
    useDefaultBtn.type = 'button';
    useDefaultBtn.hidden = !customWorkspace;
    useDefaultBtn.addEventListener('click', () => {
      formState.workspacePath = undefined;
      workspacePathInput.value = '';
      workspacePathInput.title = defaultWorkspacePath || workspacePathInput.placeholder;
      workspaceSummary.textContent = `${defaultWorkspaceLabel} (default)`;
      useDefaultBtn.hidden = true;
    });

    const workspaceActions = el('div', 'scheduler-workspace-actions');
    workspaceActions.append(browseBtn, useDefaultBtn);
    workspaceRow.append(workspacePathInput, workspaceActions);
    workspaceField.appendChild(workspaceRow);
    workspaceField.appendChild(workspaceSummary);
    workspaceField.appendChild(
      el(
        'span',
        'scheduler-field__hint',
        customWorkspace
          ? 'This job runs in the selected folder.'
          : `Unset jobs run in ${defaultWorkspaceLabel} under ~/.minnow/scheduler-workspace.`,
      ),
    );
    fields.appendChild(workspaceField);

    fields.appendChild(
      createSettingsToggleRow('Enabled', {
        checked: formState.enabled,
        onChange: (on) => {
          formState.enabled = on;
        },
      }).row,
    );

    formPanel.appendChild(fields);

    const actions = el('div', 'scheduler-editor__actions');
    const saveBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Save job');
    saveBtn.type = 'button';
    const cancelBtn = el('button', 'settings-action-btn', 'Cancel');
    cancelBtn.type = 'button';
    actions.append(saveBtn, cancelBtn);
    formPanel.appendChild(actions);

    saveBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const scheduleUi = scheduleMount.getState();
          const scheduleCheck = validateScheduleUi(scheduleUi);
          if (scheduleCheck.ok === false) {
            notify('err', scheduleCheck.error);
            scheduleMount.refreshPreview();
            return;
          }
          formState.schedule = uiToSchedule(scheduleUi);
          const hasPinnedModel =
            Boolean(formState.providerId?.trim()) && Boolean(formState.modelId?.trim());
          const jobPayload = {
            ...formState,
            workspacePath: formState.workspacePath?.trim() || '',
            providerId: hasPinnedModel ? formState.providerId?.trim() : '',
            modelId: hasPinnedModel ? formState.modelId?.trim() : '',
          };
          if (editingId) {
            await updateSchedulerJob(editingId, jobPayload);
            notify('ok', 'Job updated');
          } else {
            await createSchedulerJob(jobPayload);
            notify('ok', 'Job created');
          }
          editingId = null;
          delete formPanel.dataset.create;
          setEditorOpen(false);
          await refreshList();
        } catch (err) {
          notify('err', err instanceof Error ? err.message : String(err));
        }
      })();
    });

    cancelBtn.addEventListener('click', () => {
      editingId = null;
      delete formPanel.dataset.create;
      setEditorOpen(false);
    });
  }

  async function openSchedulerRunChat(chatId: string): Promise<void> {
    try {
      await loadSessionsFromStorage();
    } catch {
      notify('err', 'Could not reload chats from the server.');
      return;
    }

    const chat = findChatById(chatId);
    if (!chat) {
      notify('err', 'Chat for this run is not available yet.');
      return;
    }

    const chatWorkspace = chat.workspacePath?.trim();
    if (chatWorkspace && chatWorkspace !== getWorkspacePath()) {
      try {
        const info = await setWorkspacePath(chatWorkspace);
        setWorkspaceFromServer(info);
        applyWorkspaceScopedSession(chatWorkspace);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : String(err));
        return;
      }
    }

    launchApp('code');
    if (sessionState?.activeId !== chatId) {
      switchChat(chatId);
    }
  }

  async function renderHistory(jobId: string): Promise<void> {
    selectedHistoryJobId = jobId;
    historyPanel.classList.remove('hidden');
    historyPanel.replaceChildren();

    const historyHead = el('div', 'scheduler-history__head');
    historyHead.appendChild(el('h3', 'scheduler-history__title', 'Run history'));
    const closeHistory = el('button', 'settings-inline-btn scheduler-history__close', 'Close');
    closeHistory.type = 'button';
    closeHistory.addEventListener('click', () => {
      historyPanel.classList.add('hidden');
      selectedHistoryJobId = null;
    });
    historyHead.appendChild(closeHistory);
    historyPanel.appendChild(historyHead);

    let runs: SchedulerRun[] = [];
    try {
      runs = await fetchSchedulerRuns(jobId);
    } catch (err) {
      historyPanel.appendChild(
        el('p', 'scheduler-field__hint', err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    if (runs.length === 0) {
      historyPanel.appendChild(el('p', 'scheduler-history__empty', 'No runs yet for this job.'));
      return;
    }

    const table = el('table', 'scheduler-runs-table');
    const head = el('tr');
    for (const col of ['Started', 'Status', 'Exit', 'Summary']) {
      head.appendChild(el('th', undefined, col));
    }
    table.appendChild(el('thead')).appendChild(head);

    const body = el('tbody');
    for (const run of runs) {
      const row = el('tr');
      const chatId = resolveSchedulerRunChatId(run);
      if (chatId) {
        row.classList.add('scheduler-runs-table__row--clickable');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.title = 'Open chat for this run';
        row.setAttribute('aria-label', `Open chat for run started ${formatWhen(run.startedAt)}`);
        const openRunChat = (): void => {
          void openSchedulerRunChat(chatId);
        };
        row.addEventListener('click', openRunChat);
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openRunChat();
          }
        });
      }
      row.appendChild(el('td', 'scheduler-runs-table__time', formatWhen(run.startedAt)));
      const statusCell = el('td');
      const status = el('span', `scheduler-run-status scheduler-run-status--${run.status}`);
      status.textContent = run.status;
      statusCell.appendChild(status);
      row.appendChild(statusCell);
      row.appendChild(
        el('td', 'scheduler-runs-table__mono', run.exitCode != null ? String(run.exitCode) : '—'),
      );
      row.appendChild(
        el('td', undefined, formatSchedulerRunSummary(run, 120)),
      );
      body.appendChild(row);
    }
    table.appendChild(body);
    historyPanel.appendChild(table);
  }

  function createJobRow(job: ScheduledJob): HTMLElement {
    const row = el('article', 'scheduler-job');
    row.setAttribute('role', 'listitem');
    if (!job.enabled) row.classList.add('is-disabled');

    const mainCol = el('div', 'scheduler-job__main');

    const jobHead = el('div', 'scheduler-job__head');
    jobHead.appendChild(el('h3', 'scheduler-job__title', job.label || 'Untitled job'));
    jobHead.appendChild(el('span', 'scheduler-job__mode', modeLabel(job.modeId)));
    mainCol.appendChild(jobHead);

    const scheduleLine = el('div', 'scheduler-job__schedule');
    scheduleLine.appendChild(
      el(
        'span',
        'scheduler-job__cadence',
        describeSchedule(job.schedule),
      ),
    );
    const next = el('span', 'scheduler-job__next', `Next ${formatWhen(job.nextRunAt)}`);
    scheduleLine.appendChild(next);
    mainCol.appendChild(scheduleLine);

    if (job.prompt.trim()) {
      mainCol.appendChild(
        el('p', 'scheduler-job__prompt', truncateText(job.prompt, 140)),
      );
    }

    mainCol.appendChild(
      el(
        'p',
        'scheduler-job__workspace',
        `Workspace · ${formatJobWorkspaceLabel(job, defaultWorkspacePath, defaultWorkspaceLabel)}`,
      ),
    );

    mainCol.appendChild(
      el(
        'p',
        'scheduler-job__model',
        `Model · ${formatJobModelLabel(job, providerLabelById)}`,
      ),
    );

    if (job.running) {
      const running = el('span', 'scheduler-job__running');
      const dot = el('span', 'scheduler-job__running-dot');
      dot.setAttribute('aria-hidden', 'true');
      running.append(dot, el('span', undefined, 'Running'));
      mainCol.appendChild(running);
    }

    row.appendChild(mainCol);

    const actions = el('div', 'scheduler-job__actions');

    const { row: toggleRow } = createSettingsToggleRow('On', {
      checked: job.enabled,
      onChange: (on) => {
        void (async () => {
          try {
            await updateSchedulerJob(job.id, { enabled: on });
            await refreshList();
          } catch (err) {
            notify('err', err instanceof Error ? err.message : String(err));
          }
        })();
      },
    });
    toggleRow.classList.add('scheduler-job__toggle');
    actions.appendChild(toggleRow);

    const btnRow = el('div', 'scheduler-job__btn-row');

    const runBtn = el('button', 'settings-inline-btn', 'Run now');
    runBtn.type = 'button';
    runBtn.disabled = Boolean(job.running);
    runBtn.addEventListener('click', () => {
      void (async () => {
        try {
          await runSchedulerJobNow(job.id);
          notify('ok', `Started "${job.label}"`);
          await refreshList();
          if (selectedHistoryJobId === job.id) await renderHistory(job.id);
        } catch (err) {
          notify('err', err instanceof Error ? err.message : String(err));
        }
      })();
    });

    const editBtn = el('button', 'settings-inline-btn', 'Edit');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => {
      editingId = job.id;
      delete formPanel.dataset.create;
      Object.assign(formState, {
        label: job.label,
        enabled: job.enabled,
        schedule: { ...job.schedule },
        prompt: job.prompt,
        modeId: job.modeId,
        providerId: job.providerId,
        modelId: job.modelId,
        workspacePath: job.workspacePath,
        channels: [...job.channels],
      });
      setEditorOpen(true);
      renderForm();
    });

    const historyBtn = el('button', 'settings-inline-btn', 'History');
    historyBtn.type = 'button';
    historyBtn.addEventListener('click', () => {
      void renderHistory(job.id);
    });

    const deleteBtn = el('button', 'settings-inline-btn scheduler-job__delete', 'Delete');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => {
      if (!window.confirm(`Delete scheduled job "${job.label}"?`)) return;
      void (async () => {
        try {
          await deleteSchedulerJob(job.id);
          notify('ok', 'Job deleted');
          if (selectedHistoryJobId === job.id) {
            historyPanel.classList.add('hidden');
            selectedHistoryJobId = null;
          }
          if (editingId === job.id) {
            editingId = null;
            setEditorOpen(false);
          }
          await refreshList();
        } catch (err) {
          notify('err', err instanceof Error ? err.message : String(err));
        }
      })();
    });

    btnRow.append(runBtn, editBtn, historyBtn, deleteBtn);
    actions.appendChild(btnRow);
    row.appendChild(actions);
    return row;
  }

  function renderEmptyState(): HTMLElement {
    const empty = el('div', 'scheduler-empty');
    empty.appendChild(el('p', 'scheduler-empty__title', 'No scheduled jobs yet'));
    empty.appendChild(
      el(
        'p',
        'scheduler-empty__hint',
        'Run a prompt on a timer while Minnow stays open. Good for standups, reminders, and recurring checks.',
      ),
    );
    const cta = el('button', 'settings-action-btn settings-action-btn--primary', 'Create first job');
    cta.type = 'button';
    cta.addEventListener('click', openCreateForm);
    empty.appendChild(cta);
    return empty;
  }

  async function refreshList(): Promise<void> {
    list.replaceChildren();
    let jobs: ScheduledJob[] = [];
    try {
      jobs = await fetchSchedulerJobs();
    } catch (err) {
      list.appendChild(
        el('p', 'scheduler-field__hint', err instanceof Error ? err.message : String(err)),
      );
      jobCountValue.textContent = '—';
      activeCountValue.textContent = '—';
      return;
    }

    jobCountValue.textContent = String(jobs.length);
    activeCountValue.textContent = String(jobs.filter((job) => job.enabled).length);

    if (jobs.length === 0) {
      list.appendChild(renderEmptyState());
      return;
    }

    for (const job of jobs) {
      list.appendChild(createJobRow(job));
    }
  }

  addBtn.addEventListener('click', openCreateForm);
  renderForm();
  await refreshList();
}
