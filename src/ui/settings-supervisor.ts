/**
 * Settings UI for Orchestrate supervisor (`config.json` → `supervisor`).
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { invalidateSupervisorConfigCache } from '../agents/supervisor/config.ts';
import { setStatus } from './status';

type SupervisorPatch = Record<string, unknown>;

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

async function fetchConfigJson(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function saveSupervisorPatch(patch: SupervisorPatch): Promise<boolean> {
  const config = await fetchConfigJson();
  if (!config) {
    setStatus('err', 'Supervisor settings require npm start');
    return false;
  }
  const prev =
    config.supervisor && typeof config.supervisor === 'object'
      ? (config.supervisor as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'repetition' && v && typeof v === 'object') {
      const prevRep =
        merged.repetition && typeof merged.repetition === 'object'
          ? (merged.repetition as Record<string, unknown>)
          : {};
      merged.repetition = { ...prevRep, ...(v as Record<string, unknown>) };
    } else {
      merged[k] = v;
    }
  }
  config.supervisor = merged;
  try {
    const res = await fetch('/api/config/file?key=config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      setStatus('err', 'Failed to save supervisor settings');
      return false;
    }
    invalidateSupervisorConfigCache();
    setStatus('ok', 'Supervisor settings saved');
    return true;
  } catch {
    setStatus('err', 'Supervisor settings require npm start');
    return false;
  }
}

function bindNumber(
  input: HTMLInputElement,
  field: string,
  nested: string | null,
  opts: { min: number; max: number },
): void {
  input.addEventListener('change', () => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    const v = Math.min(opts.max, Math.max(opts.min, raw));
    input.value = String(v);
    void (async () => {
      const patch: SupervisorPatch = {};
      if (nested) {
        patch[field] = { [nested]: v };
      } else {
        patch[field] = v;
      }
      await saveSupervisorPatch(patch);
    })();
  });
}

/**
 * Renders the Orchestrate supervisor controls into `#settingsSupervisorBody`.
 */
export async function renderSupervisorSettingsSection(): Promise<void> {
  const mount = document.getElementById('settingsSupervisorBody');
  if (!mount) return;
  mount.replaceChildren();

  if (!isServerStorageMode()) {
    mount.appendChild(
      serverBanner('Supervisor settings require <code>npm start</code> (config.json on disk).'),
    );
    return;
  }

  const mode = await detectConfigServer();
  if (mode !== 'server') {
    mount.appendChild(serverBanner('Connect with <code>npm start</code> to edit supervisor settings.'));
    return;
  }

  const config = await fetchConfigJson();
  const sup =
    config?.supervisor && typeof config.supervisor === 'object'
      ? (config.supervisor as Record<string, unknown>)
      : {};
  const rep =
    sup.repetition && typeof sup.repetition === 'object'
      ? (sup.repetition as Record<string, unknown>)
      : {};

  const intro = el(
    'p',
    'settings-section-note',
    'The supervisor watches Orchestrate chats: stall resume, heartbeat, repetition restarts, and optional LLM escalation. Settings persist to config.json under supervisor.',
  );
  mount.appendChild(intro);

  const row = (label: string, input: HTMLElement): HTMLElement => {
    const wrap = el('div', 'settings-toggle-row');
    wrap.appendChild(el('span', undefined, label));
    wrap.appendChild(input);
    return wrap;
  };

  const mkCb = (id: string, label: string, field: string, checked: boolean): HTMLInputElement => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = checked;
    cb.addEventListener('change', () => {
      void saveSupervisorPatch({ [field]: cb.checked });
    });
    mount.appendChild(row(label, cb));
    return cb;
  };

  mkCb('settingsSupervisorEnabled', 'Enable supervisor', 'enabled', sup.enabled !== false);
  mkCb('settingsSupervisorAutoResume', 'Auto-resume orchestrator', 'autoResume', sup.autoResume !== false);
  mkCb(
    'settingsSupervisorRepetition',
    'Detect repeated tool calls (sub-agents)',
    'repetitionDetection',
    sup.repetitionDetection !== false,
  );
  mkCb('settingsSupervisorLlmEscalation', 'LLM escalation (ambiguous stalls)', 'llmEscalation', sup.llmEscalation !== false);
  mkCb(
    'settingsSupervisorAskUser',
    'Ask user when budgets are exhausted',
    'askUserOnBudgetExhausted',
    sup.askUserOnBudgetExhausted !== false,
  );

  const fieldset = el('fieldset', 'settings-part-block');
  const enabledCb = document.getElementById('settingsSupervisorEnabled') as HTMLInputElement | null;
  const syncDisabled = (): void => {
    fieldset.disabled = enabledCb ? !enabledCb.checked : false;
  };
  enabledCb?.addEventListener('change', syncDisabled);

  const details = el('details', 'settings-part-block');
  const sum = el('summary', undefined, 'Supervisor thresholds');
  details.appendChild(sum);
  details.appendChild(fieldset);
  mount.appendChild(details);

  const kv = el('dl', 'settings-kv');
  fieldset.appendChild(kv);

  const addNum = (
    term: string,
    field: string,
    nested: string | null,
    value: number,
    min: number,
    max: number,
    step: number,
    suffix?: string,
    aria?: string,
  ): void => {
    const dt = el('dt', 'settings-kv__term', term);
    kv.appendChild(dt);
    const dd = el('dd', 'settings-kv__value');
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'settings-select settings-kv-input';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    if (aria) input.setAttribute('aria-label', aria);
    bindNumber(input, field, nested, { min, max });
    dd.appendChild(input);
    if (suffix) {
      const suf = el('span', 'settings-kv-suffix', suffix);
      dd.appendChild(suf);
    }
    kv.appendChild(dd);
  };

  const n = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d;

  addNum('Board stall (R8)', 'stallMs', null, n(sup.stallMs, 30_000), 5_000, 600_000, 1000, 'ms', 'Board stall timeout in milliseconds');
  addNum('Max resumes per task', 'maxRetriesPerTask', null, n(sup.maxRetriesPerTask, 3), 0, 10, 1, '', 'Max watchdog resumes per board task');
  addNum(
    'Heartbeat timeout (R7)',
    'orchestratorHeartbeatMs',
    null,
    n(sup.orchestratorHeartbeatMs, 90_000),
    10_000,
    600_000,
    1000,
    'ms',
    'Orchestrator heartbeat timeout in milliseconds',
  );
  addNum(
    'In-progress without run (R6)',
    'inProgressNoRunMs',
    null,
    n(sup.inProgressNoRunMs, 45_000),
    10_000,
    300_000,
    1000,
    'ms',
    'In-progress task without assigned run timeout',
  );
  addNum('Spawn stuck (R5)', 'spawnStuckMs', null, n(sup.spawnStuckMs, 30_000), 5_000, 120_000, 1000, 'ms', 'Spawn stuck timeout');
  addNum(
    'Silence after tool (R4)',
    'parentSilenceAfterToolMs',
    null,
    n(sup.parentSilenceAfterToolMs, 20_000),
    5_000,
    120_000,
    1000,
    'ms',
    'Silence after parent tool result in milliseconds',
  );
  addNum(
    'Sub-agent tool silence (R1)',
    'subAgentToolSilenceMs',
    null,
    n(sup.subAgentToolSilenceMs, 60_000),
    10_000,
    300_000,
    1000,
    'ms',
    'Sub-agent tool silence timeout in milliseconds',
  );
  addNum('Max run restarts', 'runRestartCap', null, n(sup.runRestartCap, 2), 0, 10, 1, '', 'Max supervisor restarts per run');
  addNum('Max respawns per task (R2)', 'spawnCapPerTask', null, n(sup.spawnCapPerTask, 3), 0, 10, 1, '', 'Max respawns per board task');
  addNum(
    'Duplicate calls before restart',
    'repetition',
    'duplicateToolCallThreshold',
    n(rep.duplicateToolCallThreshold, 3),
    2,
    10,
    1,
    '',
    'Duplicate tool calls before supervisor restart',
  );
  addNum(
    'Max restarts per run (R3)',
    'repetition',
    'maxRestartsPerRun',
    n(rep.maxRestartsPerRun, 2),
    0,
    10,
    1,
    '',
    'Max repetition-driven restarts per sub-agent run',
  );
  addNum(
    'LLM escalations per session',
    'llmEscalationsPerSession',
    null,
    n(sup.llmEscalationsPerSession, 10),
    0,
    50,
    1,
    '',
    'LLM escalation attempts per session',
  );
  addNum(
    'LLM escalation timeout',
    'llmEscalationTimeoutMs',
    null,
    n(sup.llmEscalationTimeoutMs, 8_000),
    1_000,
    60_000,
    500,
    'ms',
    'LLM escalation request timeout in milliseconds',
  );

  const esc = el('details', 'settings-part-block');
  esc.appendChild(el('summary', undefined, 'Escalation model (optional)'));
  const escHint = el(
    'p',
    'settings-field-hint',
    'Leave empty to use the active chat provider/model. Set only if you want a dedicated escalation model.',
  );
  esc.appendChild(escHint);

  const provLabel = el('label', undefined, 'Escalation provider id');
  const prov = document.createElement('input');
  prov.type = 'text';
  prov.className = 'settings-select';
  prov.placeholder = 'Provider id';
  prov.value = typeof sup.escalationProviderId === 'string' ? sup.escalationProviderId : '';
  prov.addEventListener('change', () => {
    void saveSupervisorPatch({ escalationProviderId: prov.value.trim() });
  });
  provLabel.appendChild(prov);
  esc.appendChild(provLabel);

  const modLabel = el('label', undefined, 'Escalation model id');
  const mod = document.createElement('input');
  mod.type = 'text';
  mod.className = 'settings-select';
  mod.placeholder = 'Model id';
  mod.value = typeof sup.escalationModelId === 'string' ? sup.escalationModelId : '';
  mod.addEventListener('change', () => {
    void saveSupervisorPatch({ escalationModelId: mod.value.trim() });
  });
  modLabel.appendChild(mod);
  esc.appendChild(modLabel);

  fieldset.appendChild(esc);
  syncDisabled();
}
