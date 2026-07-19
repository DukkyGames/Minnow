/**
 * Settings → Autopilot: global orchestrate board defaults (execution, retries, heartbeat, planner).
 */

import '../styles/settings-general.css';

import {
  clampHeartbeatDeadMs,
  clampHeartbeatIntervalMs,
  clampProgressStallMs,
} from '../agents/sub-agent-config';
import {
  loadAutopilotMeta,
  saveAutopilotMeta,
  type AutopilotContinueSmartRoute,
  type AutopilotExecutionMode,
  type AutopilotIsolationMode,
} from '../config/autopilot-meta';
import {
  appendSettingsCrosslinks,
  appendSettingsGroup,
  linkToSettingsSection,
} from './settings-layout';
import {
  createSettingsKvList,
  createSettingsSelectRow,
} from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';
import {
  appendProviderModelFields,
  fillModelSelect,
  fillProviderSelect,
} from './settings-model-binding';
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

/** Compact numeric control for settings-kv rows. */
function createKvNumberInput(
  value: number,
  options: {
    min: string;
    max: string;
    step?: string;
    ariaLabel: string;
  },
): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-select settings-kv-input';
  input.min = options.min;
  input.max = options.max;
  if (options.step) input.step = options.step;
  input.value = String(value);
  input.setAttribute('aria-label', options.ariaLabel);
  return { wrap: input, input };
}

/** Show persisted millisecond durations as whole seconds in the UI. */
function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

/** Convert UI seconds back to persisted milliseconds. */
function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

function clampInfraTimeoutSeconds(seconds: number): number {
  return Math.min(600, Math.max(30, Math.round(seconds)));
}

/** Duration control shown in seconds; persisted as milliseconds. */
function createKvSecondsInput(
  valueMs: number,
  options: {
    minSeconds: number;
    maxSeconds: number;
    ariaLabel: string;
  },
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('span', 'settings-kv-input-wrap');
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-select settings-kv-input';
  input.min = String(options.minSeconds);
  input.max = String(options.maxSeconds);
  input.step = '1';
  input.value = String(msToSeconds(valueMs));
  input.setAttribute('aria-label', options.ariaLabel);
  wrap.appendChild(input);
  wrap.appendChild(el('span', 'settings-kv-suffix', 'sec'));
  return { wrap, input };
}

/** Mount orchestrate autopilot defaults into the settings section body. */
export async function renderAutopilotSettingsSection(mount: HTMLElement): Promise<void> {
  const meta = await loadAutopilotMeta();

  const shell = el('div', 'settings-general');
  mount.appendChild(shell);

  const lead = el('p', 'settings-section-lead');
  lead.append(
    'Global defaults for orchestrate boards: execution mode, concurrency, isolation, test retries, heartbeat thresholds, and planner model fallback. Per-board overrides stay on the board header. Work agents live under ',
    linkToSettingsSection('Agents', 'agent-center'),
    '; provider models under ',
    linkToSettingsSection('Providers', 'providers'),
    '.',
  );
  shell.appendChild(lead);

  const content = el('div', 'settings-general__content');
  shell.appendChild(content);

  const persist = async (patch: Parameters<typeof saveAutopilotMeta>[0]): Promise<void> => {
    try {
      await saveAutopilotMeta(patch);
      setStatus('ok', 'Autopilot settings saved');
    } catch {
      setStatus('err', 'Save failed — use npm start');
    }
  };

  const defaultsBody = appendSettingsGroup(
    content,
    'Board defaults',
    'New orchestrate boards inherit these values.',
    'agents.autopilot',
    { emphasis: true },
  );

  const modeSelect = document.createElement('select');
  modeSelect.id = 'settingsAutopilotExecMode';
  modeSelect.className = 'settings-select';
  for (const opt of [
    { value: 'manual', label: 'Manual' },
    { value: 'sequential', label: 'Sequential' },
    { value: 'auto', label: 'Auto' },
    { value: 'afk', label: 'AFK' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    modeSelect.appendChild(option);
  }
  modeSelect.value = meta.defaultExecutionMode;
  defaultsBody.appendChild(
    createSettingsSelectRow('Default execution mode', {
      select: modeSelect,
      searchKey: 'agents.autopilot.executionMode',
    }).row,
  );

  const isoSelect = document.createElement('select');
  isoSelect.id = 'settingsAutopilotIsolation';
  isoSelect.className = 'settings-select';
  for (const opt of [
    { value: 'auto', label: 'Auto (derive from execution mode)' },
    { value: 'off', label: 'Off' },
    { value: 'per-task', label: 'Per-task' },
    { value: 'per-wave', label: 'Per-wave' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    isoSelect.appendChild(option);
  }
  isoSelect.value = meta.isolationMode;
  defaultsBody.appendChild(
    createSettingsSelectRow('Default isolation mode', {
      select: isoSelect,
      searchKey: 'agents.autopilot.isolation',
    }).row,
  );

  const conc = createKvNumberInput(meta.maxConcurrentTasks, {
    min: '1',
    max: '20',
    step: '1',
    ariaLabel: 'Max concurrent tasks',
  });
  defaultsBody.appendChild(
    createSettingsKvList(
      [{ term: 'Max concurrent tasks', value: conc.wrap }],
      { searchKey: 'agents.autopilot.concurrency', className: 'settings-kv settings-kv--row' },
    ),
  );
  defaultsBody.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Applies in Auto and AFK modes. Sequential always uses one task at a time.',
    ),
  );

  const testsBody = appendSettingsGroup(
    content,
    'Test & build retries',
    'Global thresholds for per-task test/build failures and final integration tests.',
    'agents.autopilot.retries',
    { emphasis: true },
  );

  const taskAttempts = createKvNumberInput(meta.maxTestAttempts, {
    min: '1',
    max: '10',
    step: '1',
    ariaLabel: 'Per-task test attempts',
  });
  const buildAttempts = createKvNumberInput(meta.maxBuildAttempts, {
    min: '1',
    max: '10',
    step: '1',
    ariaLabel: 'Per-task build attempts',
  });
  const finalAttempts = createKvNumberInput(meta.maxFinalTestAttempts, {
    min: '1',
    max: '10',
    step: '1',
    ariaLabel: 'Final test attempts',
  });
  testsBody.appendChild(
    createSettingsKvList(
      [
        { term: 'Per-task test attempts', value: taskAttempts.wrap },
        { term: 'Per-task build attempts', value: buildAttempts.wrap },
        { term: 'Final test attempts', value: finalAttempts.wrap },
      ],
      { className: 'settings-kv settings-kv--row' },
    ),
  );

  const smartRouteSelect = document.createElement('select');
  smartRouteSelect.id = 'settingsAutopilotContinueSmartRoute';
  smartRouteSelect.className = 'settings-select';
  for (const opt of [
    { value: 'off', label: 'Off — always nudge existing chat' },
    { value: 'conservative', label: 'Conservative — derailed or very large chats' },
    { value: 'aggressive', label: 'Aggressive — lower size thresholds' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    smartRouteSelect.appendChild(option);
  }
  smartRouteSelect.value = meta.continueSmartRoute;
  testsBody.appendChild(
    createSettingsSelectRow('Continue smart-route', {
      select: smartRouteSelect,
      description:
        'When Continue would bloat a derailed build chat, hand off to a fresh summarized chat instead.',
    }).row,
  );

  const heartbeatBody = appendSettingsGroup(
    content,
    'Heartbeat & stall',
    'Supervision thresholds for orchestrate task chats (build, test, fix, final).',
    'agents.autopilot.heartbeat',
    { emphasis: true },
  );

  const heartbeat = createKvSecondsInput(meta.heartbeatIntervalMs, {
    minSeconds: 1,
    maxSeconds: 60,
    ariaLabel: 'Heartbeat interval in seconds',
  });
  const stall = createKvSecondsInput(meta.progressStallMs, {
    minSeconds: 10,
    maxSeconds: 1800,
    ariaLabel: 'Progress stall in seconds',
  });
  const dead = createKvSecondsInput(meta.heartbeatDeadMs, {
    minSeconds: 5,
    maxSeconds: 300,
    ariaLabel: 'Heartbeat dead threshold in seconds',
  });

  heartbeatBody.appendChild(
    createSettingsKvList(
      [
        { term: 'Heartbeat interval', value: heartbeat.wrap },
        { term: 'Progress stall', value: stall.wrap },
        { term: 'Heartbeat dead', value: dead.wrap },
      ],
      { className: 'settings-kv settings-kv--row' },
    ),
  );
  heartbeatBody.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Progress stall marks a task as stalled when no progress arrives for that duration. Heartbeat dead treats the supervisor as unresponsive after prolonged silence.',
    ),
  );

  const plannerBody = appendSettingsGroup(
    content,
    'Planner model fallback',
    'Task chats use the planner chat model when set, then the composer model, then this default.',
    'agents.autopilot.plannerModel',
    { emphasis: true },
  );
  const { providerSelect, modelSelect } = appendProviderModelFields(
    plannerBody,
    { provider: 'settingsAutopilotPlannerProvider', model: 'settingsAutopilotPlannerModel' },
    { provider: 'Provider', model: 'Model' },
  );
  await fillProviderSelect(providerSelect, meta.plannerProviderId || '', {
    includeEmptyOption: true,
  });
  await fillModelSelect(modelSelect, meta.plannerProviderId, meta.plannerModelId || '');

  const selfHealBody = appendSettingsGroup(
    content,
    'Self-heal & provisioning',
    'How the AFK orchestrator handles task failures, infra setup, and worktree isolation.',
    'agents.autopilot.selfHeal',
    { emphasis: true },
  );

  const healRounds = createKvNumberInput(meta.selfHealMaxRounds, {
    min: '0',
    max: '6',
    step: '1',
    ariaLabel: 'Max self-heal rounds',
  });
  const infraTimeout = createKvSecondsInput(meta.infraProvisionTimeoutMs, {
    minSeconds: 30,
    maxSeconds: 600,
    ariaLabel: 'Infra provision timeout in seconds',
  });

  selfHealBody.appendChild(
    createSettingsKvList(
      [
        { term: 'Max self-heal rounds', value: healRounds.wrap },
        { term: 'Infra provision timeout', value: infraTimeout.wrap },
      ],
      { className: 'settings-kv settings-kv--row' },
    ),
  );
  selfHealBody.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Self-heal rounds run before unconditional quarantine (0–6). Infra timeout applies to docker and provisioning commands (30–600 s).',
    ),
  );

  const { row: autoProvisionRow, input: autoProvisionToggle } = createSettingsToggleRow(
    'Auto-provision infra',
    {
      id: 'settingsAutopilotAutoProvision',
      checked: meta.autoProvisionInfra,
      searchKey: 'agents.autopilot.autoProvisionInfra',
      description:
        'Automatically attempt docker/infra provisioning when an infra failure is detected.',
    },
  );
  selfHealBody.appendChild(autoProvisionRow);

  const { row: afkRestartStallsRow, input: afkRestartStallsToggle } = createSettingsToggleRow(
    'Auto-restart stalled tasks',
    {
      id: 'settingsAutopilotAfkRestartStalls',
      checked: meta.afkAutoRestartStalls,
      searchKey: 'agents.autopilot.afkAutoRestartStalls',
      description:
        'When off, stalling tasks are quarantined immediately instead of receiving a nudge.',
    },
  );
  selfHealBody.appendChild(afkRestartStallsRow);

  const { row: guardCdRow, input: guardCdToggle } = createSettingsToggleRow(
    'Guard cd outside worktree',
    {
      id: 'settingsAutopilotGuardCd',
      checked: meta.guardCdOutsideWorktree,
      searchKey: 'agents.autopilot.guardCdOutsideWorktree',
      description:
        'Rewrite leading absolute cd commands that escape the task worktree boundary.',
    },
  );
  selfHealBody.appendChild(guardCdRow);

  appendSettingsCrosslinks(content, [
    { label: 'Edit work agents in Agents', sectionId: 'agent-center' },
    { label: 'Configure providers', sectionId: 'providers' },
  ]);

  modeSelect.addEventListener('change', () => {
    void persist({
      defaultExecutionMode: modeSelect.value as AutopilotExecutionMode,
    });
  });
  isoSelect.addEventListener('change', () => {
    void persist({
      isolationMode: isoSelect.value as AutopilotIsolationMode,
    });
  });
  conc.input.addEventListener('change', () => {
    const value = Math.min(20, Math.max(1, Math.floor(Number(conc.input.value) || 1)));
    conc.input.value = String(value);
    void persist({ maxConcurrentTasks: value });
  });
  taskAttempts.input.addEventListener('change', () => {
    const value = Math.min(
      10,
      Math.max(1, Math.floor(Number(taskAttempts.input.value) || 1)),
    );
    taskAttempts.input.value = String(value);
    void persist({ maxTestAttempts: value });
  });
  buildAttempts.input.addEventListener('change', () => {
    const value = Math.min(
      10,
      Math.max(1, Math.floor(Number(buildAttempts.input.value) || 1)),
    );
    buildAttempts.input.value = String(value);
    void persist({ maxBuildAttempts: value });
  });
  finalAttempts.input.addEventListener('change', () => {
    const value = Math.min(
      10,
      Math.max(1, Math.floor(Number(finalAttempts.input.value) || 1)),
    );
    finalAttempts.input.value = String(value);
    void persist({ maxFinalTestAttempts: value });
  });
  smartRouteSelect.addEventListener('change', () => {
    void persist({
      continueSmartRoute: smartRouteSelect.value as AutopilotContinueSmartRoute,
    });
  });
  heartbeat.input.addEventListener('change', () => {
    const ms = clampHeartbeatIntervalMs(
      secondsToMs(Number(heartbeat.input.value)),
      meta.heartbeatIntervalMs,
    );
    heartbeat.input.value = String(msToSeconds(ms));
    void persist({ heartbeatIntervalMs: ms });
  });
  stall.input.addEventListener('change', () => {
    const ms = clampProgressStallMs(secondsToMs(Number(stall.input.value)), meta.progressStallMs);
    stall.input.value = String(msToSeconds(ms));
    void persist({ progressStallMs: ms });
  });
  dead.input.addEventListener('change', () => {
    const ms = clampHeartbeatDeadMs(secondsToMs(Number(dead.input.value)), meta.heartbeatDeadMs);
    dead.input.value = String(msToSeconds(ms));
    void persist({ heartbeatDeadMs: ms });
  });
  providerSelect.addEventListener('change', async () => {
    await fillModelSelect(modelSelect, providerSelect.value, modelSelect.value);
    void persist({
      plannerProviderId: providerSelect.value,
      plannerModelId: modelSelect.value,
    });
  });
  modelSelect.addEventListener('change', () => {
    void persist({
      plannerProviderId: providerSelect.value,
      plannerModelId: modelSelect.value,
    });
  });
  healRounds.input.addEventListener('change', () => {
    const value = Math.min(6, Math.max(0, Math.floor(Number(healRounds.input.value) || 0)));
    healRounds.input.value = String(value);
    void persist({ selfHealMaxRounds: value });
  });
  infraTimeout.input.addEventListener('change', () => {
    const seconds = clampInfraTimeoutSeconds(Number(infraTimeout.input.value));
    infraTimeout.input.value = String(seconds);
    void persist({ infraProvisionTimeoutMs: secondsToMs(seconds) });
  });
  autoProvisionToggle.addEventListener('change', () => {
    void persist({ autoProvisionInfra: autoProvisionToggle.checked });
  });
  afkRestartStallsToggle.addEventListener('change', () => {
    void persist({ afkAutoRestartStalls: afkRestartStallsToggle.checked });
  });
  guardCdToggle.addEventListener('change', () => {
    void persist({ guardCdOutsideWorktree: guardCdToggle.checked });
  });
}
