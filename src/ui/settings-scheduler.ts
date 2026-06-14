/**
 * Settings → Scheduler — local recurring agent jobs and reminders.
 */

import { listModes } from '../chat/modes/registry';
import {
  createSchedulerJob,
  deleteSchedulerJob,
  fetchSchedulerJobs,
  fetchSchedulerRuns,
  runSchedulerJobNow,
  updateSchedulerJob,
  type ScheduledJob,
  type SchedulerRun,
} from '../scheduler/client';
import { appendSettingsCrosslinks } from './settings-layout';
import { createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';
import { isLocalServerAvailable } from '../tools/config';

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

const EMPTY_FORM: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt' | 'running'> = {
  label: '',
  enabled: true,
  schedule: { kind: 'interval', value: '5m' },
  prompt: '',
  modeId: 'build',
  channels: ['in_app'],
};

/** Render scheduler settings into the section mount. */
export async function renderSchedulerSettingsSection(mount: HTMLElement): Promise<void> {
  mount.replaceChildren();

  const banner = el(
    'p',
    'settings-callout settings-callout--warn',
    'Scheduled jobs only run while Minnow is open (npm start or the desktop app). They do not run when the server is stopped.',
  );
  mount.appendChild(banner);

  if (!isLocalServerAvailable()) {
    const offline = el(
      'p',
      'settings-muted',
      'Start npm start to manage scheduled jobs.',
    );
    mount.appendChild(offline);
    appendSettingsCrosslinks(mount, [
      { label: 'Servers', sectionId: 'servers' },
      { label: 'General', sectionId: 'general' },
    ]);
    return;
  }

  const toolbar = el('div', 'settings-toolbar');
  const addBtn = el('button', 'btn btn--primary', 'New job');
  addBtn.type = 'button';
  toolbar.appendChild(addBtn);
  mount.appendChild(toolbar);

  const list = el('div', 'settings-scheduler-list');
  list.setAttribute('role', 'list');
  mount.appendChild(list);

  const formPanel = el('section', 'settings-scheduler-form hidden');
  formPanel.setAttribute('aria-label', 'Job editor');
  mount.appendChild(formPanel);

  const historyPanel = el('section', 'settings-scheduler-history hidden');
  historyPanel.setAttribute('aria-label', 'Run history');
  mount.appendChild(historyPanel);

  let editingId: string | null = null;
  let selectedHistoryJobId: string | null = null;

  const formState = { ...EMPTY_FORM };

  function renderForm(): void {
    formPanel.replaceChildren();
    formPanel.classList.toggle('hidden', editingId === null && !formPanel.dataset.create);

    const title = el('h3', 'settings-subheading', editingId ? 'Edit job' : 'New job');
    formPanel.appendChild(title);

    const labelField = el('label', 'settings-field');
    labelField.textContent = 'Label';
    const labelInput = el('input', 'settings-input') as HTMLInputElement;
    labelInput.type = 'text';
    labelInput.value = formState.label;
    labelInput.addEventListener('input', () => {
      formState.label = labelInput.value;
    });
    labelField.appendChild(labelInput);
    formPanel.appendChild(labelField);

    const scheduleRow = el('div', 'settings-row');
    const kindSelect = el('select', 'settings-select') as HTMLSelectElement;
    for (const kind of ['interval', 'cron'] as const) {
      const opt = el('option', undefined, kind) as HTMLOptionElement;
      opt.value = kind;
      if (formState.schedule.kind === kind) opt.selected = true;
      kindSelect.appendChild(opt);
    }
    const valueInput = el('input', 'settings-input') as HTMLInputElement;
    valueInput.type = 'text';
    valueInput.placeholder = '5m or 0 9 * * *';
    valueInput.value = formState.schedule.value;
    kindSelect.addEventListener('change', () => {
      formState.schedule = {
        kind: kindSelect.value as 'interval' | 'cron',
        value: valueInput.value,
      };
    });
    valueInput.addEventListener('input', () => {
      formState.schedule = {
        kind: kindSelect.value as 'interval' | 'cron',
        value: valueInput.value,
      };
    });
    scheduleRow.append(kindSelect, valueInput);
    formPanel.appendChild(scheduleRow);

    const promptField = el('label', 'settings-field');
    promptField.textContent = 'Prompt';
    const promptInput = el('textarea', 'settings-textarea') as HTMLTextAreaElement;
    promptInput.rows = 4;
    promptInput.value = formState.prompt;
    promptInput.addEventListener('input', () => {
      formState.prompt = promptInput.value;
    });
    promptField.appendChild(promptInput);
    formPanel.appendChild(promptField);

    const modeField = el('label', 'settings-field');
    modeField.textContent = 'Mode';
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
    formPanel.appendChild(modeField);

    const enabledRow = createSettingsToggleRow('Enabled', {
      checked: formState.enabled,
      onChange: (on) => {
        formState.enabled = on;
      },
    });
    formPanel.appendChild(enabledRow.row);

    const actions = el('div', 'settings-toolbar');
    const saveBtn = el('button', 'btn btn--primary', 'Save');
    saveBtn.type = 'button';
    const cancelBtn = el('button', 'btn', 'Cancel');
    cancelBtn.type = 'button';
    actions.append(saveBtn, cancelBtn);
    formPanel.appendChild(actions);

    saveBtn.addEventListener('click', () => {
      void (async () => {
        try {
          if (editingId) {
            await updateSchedulerJob(editingId, formState);
            setStatus('ok', 'Scheduler job updated');
          } else {
            await createSchedulerJob(formState);
            setStatus('ok', 'Scheduler job created');
          }
          editingId = null;
          delete formPanel.dataset.create;
          await refreshList();
          formPanel.classList.add('hidden');
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : String(err));
        }
      })();
    });

    cancelBtn.addEventListener('click', () => {
      editingId = null;
      delete formPanel.dataset.create;
      formPanel.classList.add('hidden');
    });
  }

  async function renderHistory(jobId: string): Promise<void> {
    selectedHistoryJobId = jobId;
    historyPanel.classList.remove('hidden');
    historyPanel.replaceChildren();
    historyPanel.appendChild(el('h3', 'settings-subheading', 'Run history'));

    let runs: SchedulerRun[] = [];
    try {
      runs = await fetchSchedulerRuns(jobId);
    } catch (err) {
      historyPanel.appendChild(
        el('p', 'settings-muted', err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    if (runs.length === 0) {
      historyPanel.appendChild(el('p', 'settings-muted', 'No runs yet.'));
      return;
    }

    const table = el('table', 'settings-table');
    const head = el('tr');
    for (const col of ['Started', 'Status', 'Exit', 'Summary']) {
      head.appendChild(el('th', undefined, col));
    }
    table.appendChild(el('thead')).appendChild(head);

    const body = el('tbody');
    for (const run of runs) {
      const row = el('tr');
      row.appendChild(el('td', undefined, formatWhen(run.startedAt)));
      row.appendChild(el('td', undefined, run.status));
      row.appendChild(el('td', undefined, run.exitCode != null ? String(run.exitCode) : '—'));
      const summary = run.error ?? run.output?.slice(0, 120) ?? '—';
      row.appendChild(el('td', undefined, summary));
      body.appendChild(row);
    }
    table.appendChild(body);
    historyPanel.appendChild(table);
  }

  async function refreshList(): Promise<void> {
    list.replaceChildren();
    let jobs: ScheduledJob[] = [];
    try {
      jobs = await fetchSchedulerJobs();
    } catch (err) {
      list.appendChild(
        el('p', 'settings-muted', err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    if (jobs.length === 0) {
      list.appendChild(el('p', 'settings-muted', 'No scheduled jobs yet.'));
      return;
    }

    for (const job of jobs) {
      const row = el('article', 'settings-mcp-row');
      row.setAttribute('role', 'listitem');

      const head = el('div', 'settings-mcp-row__head');
      head.appendChild(el('strong', undefined, job.label));
      const meta = el(
        'span',
        'settings-muted',
        `${job.schedule.kind} ${job.schedule.value} · next ${formatWhen(job.nextRunAt)}${job.running ? ' · running' : ''}`,
      );
      head.appendChild(meta);
      row.appendChild(head);

      const actions = el('div', 'settings-toolbar');
      const runBtn = el('button', 'btn btn--small', 'Run now');
      runBtn.type = 'button';
      runBtn.disabled = Boolean(job.running);
      runBtn.addEventListener('click', () => {
        void (async () => {
          try {
            await runSchedulerJobNow(job.id);
            setStatus('ok', `Started "${job.label}"`);
            await refreshList();
            if (selectedHistoryJobId === job.id) {
              await renderHistory(job.id);
            }
          } catch (err) {
            setStatus('err', err instanceof Error ? err.message : String(err));
          }
        })();
      });

      const editBtn = el('button', 'btn btn--small', 'Edit');
      editBtn.type = 'button';
      editBtn.addEventListener('click', () => {
        editingId = job.id;
        Object.assign(formState, {
          label: job.label,
          enabled: job.enabled,
          schedule: { ...job.schedule },
          prompt: job.prompt,
          modeId: job.modeId,
          channels: [...job.channels],
        });
        formPanel.classList.remove('hidden');
        renderForm();
      });

      const historyBtn = el('button', 'btn btn--small', 'History');
      historyBtn.type = 'button';
      historyBtn.addEventListener('click', () => {
        void renderHistory(job.id);
      });

      const deleteBtn = el('button', 'btn btn--small btn--danger', 'Delete');
      deleteBtn.type = 'button';
      deleteBtn.addEventListener('click', () => {
        if (!window.confirm(`Delete scheduled job "${job.label}"?`)) return;
        void (async () => {
          try {
            await deleteSchedulerJob(job.id);
            setStatus('ok', 'Scheduler job deleted');
            if (selectedHistoryJobId === job.id) {
              historyPanel.classList.add('hidden');
              selectedHistoryJobId = null;
            }
            await refreshList();
          } catch (err) {
            setStatus('err', err instanceof Error ? err.message : String(err));
          }
        })();
      });

      const toggleRow = createSettingsToggleRow('Enabled', {
        checked: job.enabled,
        onChange: (on) => {
          void (async () => {
            try {
              await updateSchedulerJob(job.id, { enabled: on });
              await refreshList();
            } catch (err) {
              setStatus('err', err instanceof Error ? err.message : String(err));
            }
          })();
        },
      });

      actions.append(toggleRow.row, runBtn, editBtn, historyBtn, deleteBtn);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  addBtn.addEventListener('click', () => {
    editingId = null;
    formPanel.dataset.create = '1';
    Object.assign(formState, EMPTY_FORM);
    formPanel.classList.remove('hidden');
    renderForm();
  });

  renderForm();
  await refreshList();
  appendSettingsCrosslinks(mount, [
    { label: 'General', sectionId: 'general' },
    { label: 'Tools', sectionId: 'tools' },
  ]);
}
