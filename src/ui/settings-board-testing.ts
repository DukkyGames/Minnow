/**
 * Settings → Advanced → Board testing — manual orchestrate board workflow.
 */

import '../styles/settings-general.css';
import '../styles/settings-about.css';
import { detectConfigServer } from '../config/storage-mode';
import { fetchWorkspace } from '../config/workspace-api';
import { TEST_BOARD_GROUP_ID } from '../dev/test-board-seed';
import {
  checkBoardLog,
  fetchBoardTestingStatus,
  seedTestBoard,
  startFakeModel,
  stopFakeModel,
  type BoardTestingStatus,
  type CheckBoardLogResponse,
} from '../api/board-testing';
import { loadSessionsFromStorage } from '../state/sessions';
import {
  appendSettingsGroup,
  linkToSettingsSection,
} from './settings-layout';
import {
  appendSettingsOfflineHint,
  createSettingsActionsRow,
  createSettingsInputRow,
  createSettingsSelectRow,
  createSettingsTextareaRow,
} from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearMount(id: string): HTMLElement | null {
  const mount = document.getElementById(id);
  if (!mount) return null;
  mount.replaceChildren();
  return mount;
}

/** Render a compact status chip row (running/stopped, registered, seeded). */
function renderStatusChips(host: HTMLElement, status: BoardTestingStatus | null): void {
  host.replaceChildren();
  host.className = 'diagnostics-health-strip';

  const list = el('ul', 'diagnostics-health-strip__list');
  list.setAttribute('role', 'list');

  const rows = [
    {
      ok: status?.fakeModel.running === true,
      label: 'Fake model',
      detail: status?.fakeModel.running
        ? `${status.fakeModel.baseUrl ?? ''} (${status.fakeModel.requestCount} req)`
        : 'Stopped',
    },
    {
      ok: status?.providerRegistered === true,
      label: 'Provider',
      detail: status?.providerRegistered ? 'fake-board registered' : 'Not registered',
    },
    {
      ok: status?.seededBoard.present === true,
      label: 'Test boards',
      detail: status?.seededBoard.present
        ? `${status.seededBoard.count} in workspace`
        : 'None seeded',
    },
  ];

  for (const row of rows) {
    const item = el('li', 'diagnostics-health-strip__item');
    item.setAttribute('role', 'listitem');

    const dot = el('span', 'diagnostics-health-strip__dot');
    if (row.ok) dot.classList.add('is-ok');
    else dot.classList.add('is-err');

    const label = el('span', 'diagnostics-health-strip__label', row.label);
    const detail = el('span', 'diagnostics-health-strip__detail', row.detail ?? '');

    item.append(dot, label, detail);
    list.appendChild(item);
  }

  host.appendChild(list);
}

function renderValidationResult(host: HTMLElement, result: CheckBoardLogResponse): void {
  host.replaceChildren();
  host.className = 'diagnostics-subsection';

  const title = el(
    'h4',
    'diagnostics-subsection__title',
    result.ok ? 'Validation passed' : 'Validation failed',
  );
  host.appendChild(title);

  const lines: string[] = [
    `Log: ${result.logPath ?? '—'}`,
    `Events: ${result.eventsCount ?? 0}`,
  ];
  if (result.skippedInvariants?.length) {
    lines.push(`Skipped: ${result.skippedInvariants.join(', ')}`);
  }

  if (result.violations?.length) {
    lines.push('', 'Violations:');
    for (const v of result.violations) {
      lines.push(`  [${v.id}] ${v.taskId ? `${v.taskId}: ` : ''}${v.message}`);
    }
  } else if (result.ok) {
    lines.push('', 'All checked invariants passed.');
  }

  const pre = el('pre', 'diagnostics-log-tail');
  pre.textContent = lines.join('\n');
  host.appendChild(pre);
}

/** Populate Settings → Advanced → Board testing. */
export async function renderBoardTestingSettingsSection(): Promise<void> {
  const mount = clearMount('settingsBoardTestingBody');
  if (!mount) return;

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Manual orchestrate board workflow: fake model, seed a test board, validate diagnostic logs. For the full automated suite, see ',
  );
  const guideLink = el('a', 'settings-inline-link');
  guideLink.href = 'documentation/guides/orchestrate-board-testing.md';
  guideLink.textContent = 'orchestrate-board-testing.md';
  guideLink.title = 'Open testing guide';
  lead.append(guideLink, '. Planner chat must use the fake board model under ', linkToSettingsSection('Providers', 'providers'), '.');
  shell.appendChild(lead);

  const serverUp = await detectConfigServer();
  if (!serverUp) {
    appendSettingsOfflineHint(
      shell,
      'Board testing requires <code>npm start</code>. CLI commands remain available for CI.',
    );
  }

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const statusHost = el('div', 'board-testing-status-host');
  content.appendChild(statusHost);

  let currentStatus: BoardTestingStatus | null = null;

  async function refreshStatus(): Promise<void> {
    if (!serverUp) {
      renderStatusChips(statusHost, null);
      return;
    }
    try {
      currentStatus = await fetchBoardTestingStatus();
      renderStatusChips(statusHost, currentStatus);
    } catch {
      renderStatusChips(statusHost, null);
    }
  }

  const fakeGroup = appendSettingsGroup(
    content,
    'Fake model',
    'In-process OpenAI-v1 stub on the tool server. Start registers provider fake-board.',
    'advanced.boardTesting.fakeModel',
    { emphasis: true },
  );

  const fakeActions = createSettingsActionsRow(
    [
      {
        label: 'Start',
        variant: 'primary',
        onClick: () => {
          void (async () => {
            if (!serverUp) {
              setStatus('err', 'Tool server offline');
              return;
            }
            try {
              setStatus('spin', 'Starting fake model…');
              await startFakeModel();
              setStatus('ok', 'Fake model running');
              await refreshStatus();
            } catch (err) {
              setStatus('err', err instanceof Error ? err.message : 'Start failed');
            }
          })();
        },
      },
      {
        label: 'Stop',
        onClick: () => {
          void (async () => {
            if (!serverUp) {
              setStatus('err', 'Tool server offline');
              return;
            }
            try {
              setStatus('spin', 'Stopping fake model…');
              await stopFakeModel();
              setStatus('ok', 'Fake model stopped');
              await refreshStatus();
            } catch (err) {
              setStatus('err', err instanceof Error ? err.message : 'Stop failed');
            }
          })();
        },
      },
      {
        label: 'Refresh status',
        onClick: () => {
          void refreshStatus();
        },
      },
    ],
    { searchKey: 'advanced.boardTesting.fakeModel.actions' },
  );
  fakeGroup.appendChild(fakeActions);

  const seedGroup = appendSettingsGroup(
    content,
    'Seed test board',
    'Writes a pre-initialized planner + board into ~/.minnow sessions. Each seed creates a new board folder.',
    'advanced.boardTesting.seed',
    { emphasis: true },
  );

  let preset: 'quick' | 'smoke' = 'quick';
  let mode: 'manual' | 'auto' | 'sequential' = 'manual';
  let autoStart = false;
  let workspacePath = '';

  const workspaceInfo = serverUp ? await fetchWorkspace() : null;
  workspacePath = workspaceInfo?.path ?? '';

  const { row: presetRow, select: presetSelect } = createSettingsSelectRow('Preset', {
    options: [
      { value: 'quick', label: 'Quick (3 parallel W1 tasks)' },
      { value: 'smoke', label: 'Smoke (full board-smoke plan)' },
    ],
    value: preset,
    searchKey: 'advanced.boardTesting.seed.preset',
    onChange: (value) => {
      preset = value === 'smoke' ? 'smoke' : 'quick';
    },
  });
  presetSelect.id = 'boardTestingPreset';
  seedGroup.appendChild(presetRow);

  const { row: modeRow, select: modeSelect } = createSettingsSelectRow('Execution mode', {
    options: [
      { value: 'manual', label: 'Manual' },
      { value: 'auto', label: 'Auto' },
      { value: 'sequential', label: 'Sequential' },
    ],
    value: mode,
    searchKey: 'advanced.boardTesting.seed.mode',
    onChange: (value) => {
      if (value === 'auto' || value === 'sequential') mode = value;
      else mode = 'manual';
    },
  });
  modeSelect.id = 'boardTestingMode';
  seedGroup.appendChild(modeRow);

  const { row: autoStartRow } = createSettingsToggleRow('Auto-start board', {
    checked: autoStart,
    description: 'Set board.autoRunning (use with auto execution mode).',
    searchKey: 'advanced.boardTesting.seed.autoStart',
    onChange: (next) => {
      autoStart = next;
    },
  });
  seedGroup.appendChild(autoStartRow);

  const { row: workspaceRow, input: workspaceInput } = createSettingsInputRow('Workspace path', {
    value: workspacePath,
    searchKey: 'advanced.boardTesting.seed.workspace',
    description: 'Folder for the seeded planner and board group.',
    onChange: (value) => {
      workspacePath = value;
    },
  });
  workspaceInput.id = 'boardTestingWorkspace';
  seedGroup.appendChild(workspaceRow);

  const seedResultHost = el('pre', 'diagnostics-log-tail');
  seedResultHost.setAttribute('aria-live', 'polite');
  seedGroup.appendChild(seedResultHost);

  let groupIdInput: HTMLInputElement | null = null;

  const seedActions = createSettingsActionsRow(
    [
      {
        label: 'Seed board',
        variant: 'primary',
        onClick: () => {
          void (async () => {
            if (!serverUp) {
              setStatus('err', 'Tool server offline');
              return;
            }
            try {
              setStatus('spin', 'Seeding test board…');
              const result = await seedTestBoard({
                workspacePath: workspacePath.trim() || undefined,
                preset,
                mode,
                autoStart,
              });
              await loadSessionsFromStorage({ force: true });
              if (groupIdInput) groupIdInput.value = result.groupId ?? '';
              seedResultHost.textContent = [
                `group:    ${result.groupId}`,
                `planner:  ${result.plannerId}`,
                `workspace: ${result.workspacePath}`,
                `tasks:    ${result.taskCount}`,
                '',
                'Restart Minnow or re-open the workspace if the board was already open.',
              ].join('\n');
              setStatus('ok', 'Test board seeded');
              await refreshStatus();
            } catch (err) {
              seedResultHost.textContent = '';
              setStatus('err', err instanceof Error ? err.message : 'Seed failed');
            }
          })();
        },
      },
    ],
    { searchKey: 'advanced.boardTesting.seed.actions' },
  );
  seedGroup.appendChild(seedActions);

  const logGroup = appendSettingsGroup(
    content,
    'Validate board log',
    'Check ~/.minnow/logs/orchestrate/<groupId>.jsonl against structural invariants.',
    'advanced.boardTesting.log',
    { emphasis: true },
  );

  const { row: groupIdRow, input: groupIdField } = createSettingsInputRow('Group id', {
    value: TEST_BOARD_GROUP_ID,
    searchKey: 'advanced.boardTesting.log.groupId',
    description: 'Board group id or direct path to a .jsonl file.',
    onChange: () => {},
  });
  groupIdField.id = 'boardTestingGroupId';
  groupIdInput = groupIdField;
  logGroup.appendChild(groupIdRow);

  const { row: planRow, textarea: planTextarea } = createSettingsTextareaRow('Plan JSON (optional)', {
    value: '',
    rows: 5,
    searchKey: 'advanced.boardTesting.log.plan',
    description:
      'Optional task graph: { "tasks": [{ "id", "wave?", "dependsOn?" }], "waveOrder?", "caps?" }. Without it, wave-order and dependency-order are skipped.',
    onChange: () => {},
  });
  planTextarea.id = 'boardTestingPlanJson';
  planTextarea.spellcheck = false;
  logGroup.appendChild(planRow);

  const validationHost = el('div', 'board-testing-validation-host');
  logGroup.appendChild(validationHost);

  const logActions = createSettingsActionsRow(
    [
      {
        label: 'Validate',
        variant: 'primary',
        onClick: () => {
          void (async () => {
            if (!serverUp) {
              setStatus('err', 'Tool server offline');
              return;
            }
            const groupId = groupIdInput.value.trim();
            if (!groupId) {
              setStatus('err', 'Group id is required');
              return;
            }

            let plan: unknown;
            const planRaw = planTextarea.value.trim();
            if (planRaw) {
              try {
                plan = JSON.parse(planRaw);
              } catch {
                setStatus('err', 'Plan JSON is invalid');
                return;
              }
            }

            try {
              setStatus('spin', 'Validating board log…');
              const result = await checkBoardLog({ groupId, plan });
              renderValidationResult(validationHost, result);
              setStatus(result.ok ? 'ok' : 'err', result.ok ? 'Log validation passed' : 'Log validation failed');
            } catch (err) {
              validationHost.replaceChildren();
              setStatus('err', err instanceof Error ? err.message : 'Validation failed');
            }
          })();
        },
      },
    ],
    { searchKey: 'advanced.boardTesting.log.actions' },
  );
  logGroup.appendChild(logActions);

  await refreshStatus();
}
