/**
 * Settings → Evals: packs, suite composer, results leaderboard.
 */

import { fetchEvalConfig, saveEvalConfig } from '../evals/config';
import {
  deleteUserEvalPack,
  fetchEvalPack,
  fetchEvalPacksList,
  fetchEvalRun,
  listEvalRuns,
  pingEvalsApi,
  saveUserEvalPack,
  type EvalRunSummary,
} from '../evals/eval-api';
import { subscribeEvalSuiteProgress } from '../evals/eval-events';
import { abortEvalSuite, runEvalSuite } from '../evals/suite-scheduler';
import type { EvalModelTarget, EvalPackListItem } from '../evals/types';
import { listProviders } from '../providers/store';
import { getWorkspacePath } from '../state/workspace';
import { getActiveChat } from '../state/sessions';
import { isLocalServerAvailable } from '../tools/config';
import { setStatus } from './status';

type EvalTab = 'packs' | 'run' | 'results';

let activeTab: EvalTab = 'run';
let selectedPackId = 'coding-smoke';
let runInProgress = false;
let activeSuiteRunId: string | null = null;
const selectedTargets: EvalModelTarget[] = [];

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

function renderTabs(mount: HTMLElement, onChange: () => void): void {
  const tabs = el('div', 'settings-evals-tabs');
  for (const tab of ['packs', 'run', 'results'] as EvalTab[]) {
    const btn = el('button', 'settings-evals-tab', tab.charAt(0).toUpperCase() + tab.slice(1));
    btn.type = 'button';
    btn.classList.toggle('is-active', tab === activeTab);
    btn.addEventListener('click', () => {
      activeTab = tab;
      onChange();
    });
    tabs.appendChild(btn);
  }
  mount.appendChild(tabs);
}

async function renderPacksPanel(body: HTMLElement): Promise<void> {
  const hint = el(
    'p',
    'settings-field-hint',
    isLocalServerAvailable()
      ? 'Built-in packs ship in src/evals/packs/. User packs override by id under ~/.minnow/evals/packs/.'
      : 'Start with npm start to save custom packs and persist run history.',
  );
  body.appendChild(hint);

  let packs: EvalPackListItem[] = [];
  try {
    packs = await fetchEvalPacksList();
  } catch {
    body.appendChild(el('p', 'settings-field-hint', 'Could not load packs.'));
    return;
  }

  const list = el('ul', 'settings-list');
  for (const pack of packs) {
    const li = el('li', 'settings-skill-card');
    const head = el('div', 'settings-skill-card__head');
    head.appendChild(el('strong', undefined, pack.label));
    head.appendChild(
      el('span', 'settings-badge', `${pack.source} · ${pack.taskCount} tasks`),
    );
    li.appendChild(head);

    const actions = el('div', 'settings-actions');
    const viewBtn = el('button', 'settings-action-btn', 'View JSON');
    viewBtn.type = 'button';
    viewBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const full = await fetchEvalPack(pack.id);
          const ta = document.createElement('textarea');
          ta.className = 'settings-part-editor';
          ta.rows = 16;
          ta.value = JSON.stringify(full, null, 2);
          body.innerHTML = '';
          body.appendChild(el('h3', undefined, pack.label));
          body.appendChild(ta);
          const back = el('button', 'settings-action-btn', 'Back to list');
          back.type = 'button';
          back.addEventListener('click', () => void renderPacksPanel(body));
          body.appendChild(back);
          if (pack.source === 'user' && isLocalServerAvailable()) {
            const saveBtn = el('button', 'settings-action-btn', 'Save pack');
            saveBtn.type = 'button';
            saveBtn.addEventListener('click', () => {
              void (async () => {
                try {
                  const parsed = JSON.parse(ta.value) as import('../evals/types').EvalPack;
                  await saveUserEvalPack(parsed);
                  setStatus('ok', 'Pack saved');
                  void renderPacksPanel(body);
                } catch (err) {
                  setStatus('err', err instanceof Error ? err.message : 'Save failed');
                }
              })();
            });
            body.appendChild(saveBtn);
            const delBtn = el('button', 'settings-action-btn settings-action-btn--danger', 'Delete');
            delBtn.type = 'button';
            delBtn.addEventListener('click', () => {
              void (async () => {
                await deleteUserEvalPack(pack.id);
                setStatus('ok', 'Pack deleted');
                void renderPacksPanel(body);
              })();
            });
            body.appendChild(delBtn);
          }
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : 'Load failed');
        }
      })();
    });
    actions.appendChild(viewBtn);

    if (pack.source === 'builtin' && isLocalServerAvailable()) {
      const dupBtn = el('button', 'settings-action-btn', 'Copy to user packs');
      dupBtn.type = 'button';
      dupBtn.addEventListener('click', () => {
        void (async () => {
          const full = await fetchEvalPack(pack.id);
          const copy = { ...full, id: `${pack.id}-custom`, label: `${pack.label} (custom)` };
          await saveUserEvalPack(copy);
          setStatus('ok', 'Copied to user packs');
        })();
      });
      actions.appendChild(dupBtn);
    }

    li.appendChild(actions);
    list.appendChild(li);
  }
  body.appendChild(list);
}

function ensureDefaultTarget(): void {
  if (selectedTargets.length > 0) return;
  const chat = getActiveChat();
  if (chat?.providerId && chat?.modelId) {
    selectedTargets.push({
      providerId: chat.providerId,
      modelId: chat.modelId,
      label: 'Active chat model',
    });
  }
}

async function renderRunPanel(body: HTMLElement): Promise<void> {
  ensureDefaultTarget();
  const apiOk = await pingEvalsApi();
  body.appendChild(
    el(
      'p',
      'settings-field-hint',
      apiOk
        ? `Workspace: ${getWorkspacePath() || '(none — open a workspace folder)'}`
        : 'Persistence requires npm start. Runs still execute in-browser when offline.',
    ),
  );

  const packLabel = el('label', 'settings-field-label', 'Task pack');
  const packSelect = document.createElement('select');
  packSelect.className = 'settings-select';
  let packs: EvalPackListItem[] = [];
  try {
    packs = await fetchEvalPacksList();
  } catch {
    /* empty */
  }
  for (const pack of packs) {
    const opt = document.createElement('option');
    opt.value = pack.id;
    opt.textContent = `${pack.label} (${pack.taskCount})`;
    packSelect.appendChild(opt);
  }
  packSelect.value = selectedPackId;
  packSelect.addEventListener('change', () => {
    selectedPackId = packSelect.value;
  });
  body.appendChild(packLabel);
  body.appendChild(packSelect);

  body.appendChild(el('p', 'settings-field-hint', 'Model targets (provider + model id):'));
  const targetsMount = el('div', 'settings-evals-targets');
  const redrawTargets = (): void => {
    targetsMount.innerHTML = '';
    selectedTargets.forEach((t, index) => {
      const row = el('div', 'settings-evals-target-row');
      const prov = document.createElement('input');
      prov.className = 'settings-select';
      prov.placeholder = 'providerId';
      prov.value = t.providerId;
      prov.addEventListener('change', () => {
        t.providerId = prov.value.trim();
      });
      const model = document.createElement('input');
      model.className = 'settings-select';
      model.placeholder = 'modelId';
      model.value = t.modelId;
      model.addEventListener('change', () => {
        t.modelId = model.value.trim();
      });
      const remove = el('button', 'settings-action-btn', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        selectedTargets.splice(index, 1);
        redrawTargets();
      });
      row.appendChild(prov);
      row.appendChild(model);
      row.appendChild(remove);
      targetsMount.appendChild(row);
    });
  };
  redrawTargets();
  body.appendChild(targetsMount);

  const addTarget = el('button', 'settings-action-btn', 'Add model');
  addTarget.type = 'button';
  addTarget.addEventListener('click', () => {
    selectedTargets.push({ providerId: '', modelId: '', label: '' });
    redrawTargets();
  });
  body.appendChild(addTarget);

  const { providers, activeProviderId } = await listProviders();
  const quickAdd = el('button', 'settings-action-btn', 'Add from provider list');
  quickAdd.type = 'button';
  quickAdd.addEventListener('click', () => {
    const pid = activeProviderId || providers[0]?.id || '';
    if (!pid) return;
    selectedTargets.push({ providerId: pid, modelId: '', label: pid });
    redrawTargets();
  });
  body.appendChild(quickAdd);

  const progressWrap = el('div', 'settings-evals-progress');
  progressWrap.hidden = true;
  const progressText = el('p', 'settings-field-hint', '');
  const progressBar = el('div', 'settings-evals-progress__bar');
  const progressFill = el('div', 'settings-evals-progress__fill');
  progressBar.appendChild(progressFill);
  progressWrap.appendChild(progressText);
  progressWrap.appendChild(progressBar);
  body.appendChild(progressWrap);

  const actions = el('div', 'settings-actions');
  const startBtn = el('button', 'settings-action-btn settings-action-btn--primary', 'Start suite');
  startBtn.type = 'button';
  startBtn.disabled = runInProgress;
  const abortBtn = el('button', 'settings-action-btn', 'Abort');
  abortBtn.type = 'button';
  abortBtn.disabled = !runInProgress;

  startBtn.addEventListener('click', () => {
    void (async () => {
      const pack = packs.find((p) => p.id === selectedPackId);
      const cellEstimate = (pack?.taskCount ?? 0) * selectedTargets.length;
      if (cellEstimate > 20) {
        const ok = window.confirm(
          `This suite will run ${cellEstimate} cells (tasks × models). Continue?`,
        );
        if (!ok) return;
      }
      const chat = getActiveChat();
      runInProgress = true;
      startBtn.disabled = true;
      abortBtn.disabled = false;
      progressWrap.hidden = false;
      try {
        const suiteRunId = await runEvalSuite({
          request: {
            packId: selectedPackId,
            targets: selectedTargets.filter((t) => t.providerId && t.modelId),
            workspacePath: getWorkspacePath(),
            modeId: 'build',
          },
          fallbackProviderId: chat?.providerId ?? activeProviderId ?? '',
          fallbackModelId: chat?.modelId ?? '',
          defaultWorkspacePath: getWorkspacePath(),
        });
        activeSuiteRunId = suiteRunId;
        setStatus('ok', `Suite ${suiteRunId} finished`);
        activeTab = 'results';
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : 'Suite failed');
      } finally {
        runInProgress = false;
        startBtn.disabled = false;
        abortBtn.disabled = true;
        progressWrap.hidden = true;
      }
    })();
  });

  abortBtn.addEventListener('click', () => {
    if (activeSuiteRunId) abortEvalSuite(activeSuiteRunId);
  });

  actions.appendChild(startBtn);
  actions.appendChild(abortBtn);
  body.appendChild(actions);

  const config = await fetchEvalConfig();
  const concLabel = el('label', 'settings-field-label', 'Max concurrency');
  const concInput = document.createElement('input');
  concInput.type = 'number';
  concInput.className = 'settings-select';
  concInput.min = '1';
  concInput.max = '8';
  concInput.value = String(config.maxConcurrency);
  concInput.addEventListener('change', () => {
    void saveEvalConfig({
      ...config,
      maxConcurrency: Math.max(1, Math.min(8, Number(concInput.value) || 2)),
    });
  });
  body.appendChild(concLabel);
  body.appendChild(concInput);

  subscribeEvalSuiteProgress((ev) => {
    if (runInProgress) {
      progressWrap.hidden = false;
      progressText.textContent = `${ev.completedCells} / ${ev.totalCells} — ${ev.currentTaskId ?? ''} @ ${ev.currentModelLabel ?? ''}`;
      const pct = ev.totalCells > 0 ? (ev.completedCells / ev.totalCells) * 100 : 0;
      progressFill.style.width = `${pct}%`;
      activeSuiteRunId = ev.suiteRunId;
    }
  });
}

async function renderResultsPanel(body: HTMLElement): Promise<void> {
  let runs: EvalRunSummary[] = [];
  try {
    runs = await listEvalRuns();
  } catch {
    body.appendChild(el('p', 'settings-field-hint', 'No runs (npm start required).'));
    return;
  }

  if (runs.length === 0) {
    body.appendChild(
      el('p', 'settings-field-hint', 'No suite runs yet. Try the coding-smoke starter pack.'),
    );
    return;
  }

  const list = el('ul', 'settings-list');
  for (const run of runs) {
    const li = el('li', 'settings-skill-card');
    li.appendChild(
      el('strong', undefined, `${run.packLabel} — ${run.status}`),
    );
    li.appendChild(
      el(
        'span',
        'settings-badge',
        `${run.completedCells}/${run.totalCells} · ${run.startedAt}`,
      ),
    );
    const openBtn = el('button', 'settings-action-btn', 'Leaderboard');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const detail = await fetchEvalRun(run.suiteRunId);
          body.innerHTML = '';
          body.appendChild(el('h3', undefined, run.packLabel));
          const table = el('table', 'settings-evals-leaderboard');
          const thead = document.createElement('thead');
          const headRow = document.createElement('tr');
          for (const col of [
            'Model',
            'Mean score',
            'Pass rate',
            'Median ms',
            'Failed',
          ]) {
            const th = document.createElement('th');
            th.textContent = col;
            headRow.appendChild(th);
          }
          thead.appendChild(headRow);
          table.appendChild(thead);
          const tbody = document.createElement('tbody');
          for (const row of detail.leaderboard) {
            const tr = document.createElement('tr');
            const cells = [
              row.label,
              String(row.meanScore),
              `${Math.round(row.passRate * 100)}%`,
              String(row.medianDurationMs),
              String(row.failedCells),
            ];
            for (const text of cells) {
              const td = document.createElement('td');
              td.textContent = text;
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          body.appendChild(table);
          const exportBtn = el('button', 'settings-action-btn', 'Download JSON');
          exportBtn.type = 'button';
          exportBtn.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(detail, null, 2)], {
              type: 'application/json',
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${run.suiteRunId}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          });
          body.appendChild(exportBtn);
          const back = el('button', 'settings-action-btn', 'Back');
          back.type = 'button';
          back.addEventListener('click', () => void renderResultsPanel(body));
          body.appendChild(back);
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : 'Load failed');
        }
      })();
    });
    li.appendChild(openBtn);
    list.appendChild(li);
  }
  body.appendChild(list);
}

/** Mount evals settings section into #settingsEvalsBody. */
export async function renderEvalsSettingsSection(mount: HTMLElement): Promise<void> {
  mount.innerHTML = '';
  mount.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Compare local models on repeatable task packs with LLM rubric grading. Results persist under ~/.minnow/evals/.',
    ),
  );

  const panel = el('div', 'settings-evals-panel');
  const body = el('div', 'settings-section-body');

  const refresh = (): void => {
    body.innerHTML = '';
    if (activeTab === 'packs') void renderPacksPanel(body);
    else if (activeTab === 'run') void renderRunPanel(body);
    else void renderResultsPanel(body);
  };

  renderTabs(panel, refresh);
  panel.appendChild(body);
  mount.appendChild(panel);
  refresh();
}
