/**
 * Settings → Agents → Watchdog: agent supervision thresholds.
 *
 * These used to be split between Autopilot ("Heartbeat & stall") and the Agents page
 * ("Duplicate tool limit"), which hid the fact that they are one policy applied to both
 * sub-agents and orchestrate task chats.
 */

import {
  clampDuplicateToolCallThreshold,
  loadSubAgentConfig,
  saveSubAgentConfigToServer,
} from '../agents/sub-agent-config';
import { resolveSelfHealMaxRounds } from '../config/autopilot-meta';
import {
  DEFAULT_SUPERVISION_THRESHOLDS,
  isAgentSupervisionEnabled,
  loadSupervisionThresholds,
  saveSupervisionThresholds,
  type SupervisionThresholds,
} from '../config/supervision-thresholds';
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { createSettingsKvList } from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';
import { msToSeconds, secondsToMs } from './settings-duration';
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

function createSecondsInput(
  valueMs: number,
  options: { ariaLabel: string },
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('span', 'settings-kv-input-wrap');
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-select settings-kv-input';
  input.min = '0';
  input.step = '1';
  input.value = String(msToSeconds(valueMs));
  input.setAttribute('aria-label', options.ariaLabel);
  wrap.appendChild(input);
  wrap.appendChild(el('span', 'settings-kv-suffix', 'sec'));
  return { wrap, input };
}

function createCountInput(
  value: number,
  options: { ariaLabel: string },
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('span', 'settings-kv-input-wrap');
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-select settings-kv-input';
  input.min = '0';
  input.step = '1';
  input.value = String(value);
  input.setAttribute('aria-label', options.ariaLabel);
  wrap.appendChild(input);
  return { wrap, input };
}

/** Mount the supervision thresholds panel (Settings → Agents → Watchdog). */
export async function renderAgentSupervisionSection(
  mount: HTMLElement,
  options?: { emphasis?: boolean },
): Promise<void> {
  const [thresholds, subAgents] = await Promise.all([
    loadSupervisionThresholds(),
    loadSubAgentConfig(),
  ]);

  const body = appendSettingsGroup(
    mount,
    'Agent supervision',
    'When a running agent looks stuck, the watchdog steps in. Applies to sub-agents and to orchestrate task chats. Set any threshold to 0 to turn that check off.',
    'agents.watchdog.supervision',
    options?.emphasis ? { emphasis: true } : undefined,
  );

  const persistThresholds = async (
    patch: Partial<SupervisionThresholds>,
  ): Promise<void> => {
    try {
      await saveSupervisionThresholds(patch);
      setStatus('ok', 'Supervision thresholds saved');
    } catch {
      setStatus('err', 'Could not save. Open or restart Minnow and try again.');
    }
  };

  const syncSupervisionInputsEnabled = (enabled: boolean): void => {
    stall.input.disabled = !enabled;
    dead.input.disabled = !enabled;
    heartbeat.input.disabled = !enabled;
    duplicateInput.disabled = !enabled;
  };

  const { row: enabledRow, input: enabledToggle } = createSettingsToggleRow(
    'Enable agent supervision',
    {
      checked: isAgentSupervisionEnabled(thresholds, subAgents.duplicateToolCallThreshold ?? 0),
      description:
        'When off, stall, heartbeat, and repeated-tool recovery are disabled for sub-agents and orchestrate task chats.',
      searchKey: 'agents.watchdog.supervision.enabled',
    },
  );
  body.appendChild(enabledRow);

  const stall = createSecondsInput(thresholds.progressStallMs, {
    ariaLabel: 'Stall timeout in seconds (0 disables)',
  });
  const dead = createSecondsInput(thresholds.heartbeatDeadMs, {
    ariaLabel: 'Unresponsive threshold in seconds (0 disables)',
  });
  const heartbeat = createSecondsInput(thresholds.heartbeatIntervalMs, {
    ariaLabel: 'Heartbeat interval in seconds (0 disables)',
  });

  const duplicate = createCountInput(
    subAgents.duplicateToolCallThreshold ?? clampDuplicateToolCallThreshold(undefined),
    {
      ariaLabel: 'Repeated tool calls before the run counts as looping (0 disables)',
    },
  );
  const duplicateInput = duplicate.input;

  body.appendChild(
    createSettingsKvList(
      [
        { term: 'Stall timeout', value: stall.wrap },
        { term: 'Unresponsive after', value: dead.wrap },
        { term: 'Heartbeat interval', value: heartbeat.wrap },
        { term: 'Repeated tool limit', value: duplicate.wrap },
      ],
      { className: 'settings-kv settings-watchdog-supervision__thresholds' },
    ),
  );

  syncSupervisionInputsEnabled(enabledToggle.checked);

  enabledToggle.addEventListener('change', () => {
    void (async () => {
      if (enabledToggle.checked) {
        const defaults = DEFAULT_SUPERVISION_THRESHOLDS;
        stall.input.value = String(msToSeconds(defaults.progressStallMs));
        dead.input.value = String(msToSeconds(defaults.heartbeatDeadMs));
        heartbeat.input.value = String(msToSeconds(defaults.heartbeatIntervalMs));
        duplicateInput.value = String(clampDuplicateToolCallThreshold(undefined));
        syncSupervisionInputsEnabled(true);
        try {
          await saveSupervisionThresholds({
            progressStallMs: defaults.progressStallMs,
            heartbeatDeadMs: defaults.heartbeatDeadMs,
            heartbeatIntervalMs: defaults.heartbeatIntervalMs,
          });
          const fresh = await loadSubAgentConfig();
          const ok = await saveSubAgentConfigToServer({
            ...fresh,
            duplicateToolCallThreshold: clampDuplicateToolCallThreshold(undefined),
          });
          setStatus(
            ok ? 'ok' : 'err',
            ok ? 'Agent supervision enabled' : 'Could not save. Open or restart Minnow and try again.',
          );
        } catch {
          setStatus('err', 'Could not save. Open or restart Minnow and try again.');
        }
        return;
      }

      syncSupervisionInputsEnabled(false);
      try {
        await saveSupervisionThresholds({
          progressStallMs: 0,
          heartbeatDeadMs: 0,
          heartbeatIntervalMs: 0,
        });
        const fresh = await loadSubAgentConfig();
        const ok = await saveSubAgentConfigToServer({
          ...fresh,
          duplicateToolCallThreshold: 0,
        });
        setStatus(
          ok ? 'ok' : 'err',
          ok ? 'Agent supervision disabled' : 'Could not save. Open or restart Minnow and try again.',
        );
      } catch {
        setStatus('err', 'Could not save. Open or restart Minnow and try again.');
      }
    })();
  });

  const notes = el('div', 'settings-watchdog-supervision__notes');
  const explain = el('div', 'settings-field-hint');
  explain.appendChild(
    el(
      'p',
      undefined,
      'Stall timeout — how long an agent may go without producing anything observable (streamed text, reasoning, or a tool call) before it counts as stuck. Long single-shot reasoning is the usual false positive; raise this if your reviewer model thinks for minutes at a time. Set 0 to disable.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Unresponsive after — how long without any heartbeat at all before the run is treated as dead. This is process-level liveness, not model output. Set 0 to disable.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Heartbeat interval — how often a running agent reports in. Lower values detect a dead run sooner at the cost of more timer wakeups. Set 0 to disable periodic heartbeats.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Repeated tool limit — how many identical tool calls (same name and arguments) may occur close together before the run counts as looping. Repeats spread across a long run are ignored. Set 0 to turn loop detection off.',
    ),
  );
  notes.appendChild(explain);

  const recovery = el('p', 'settings-field-hint');
  recovery.append(
    `When a run trips any of these, read-only agents are restarted from scratch, up to ${resolveSelfHealMaxRounds()} attempts per task. Agents that can write files are not auto-restarted — the task is marked blocked so you can look at it. Change the attempt cap under `,
    linkToSettingsSection('Autopilot', 'autopilot'),
    ' → Self-heal & provisioning.',
  );
  notes.appendChild(recovery);
  body.appendChild(notes);

  const persistSeconds = (
    input: HTMLInputElement,
    patchKey: keyof SupervisionThresholds,
  ): void => {
    input.addEventListener('change', () => {
      const seconds = Math.max(0, Math.round(Number(input.value) || 0));
      input.value = String(seconds);
      void persistThresholds({ [patchKey]: secondsToMs(seconds) });
    });
  };

  persistSeconds(stall.input, 'progressStallMs');
  persistSeconds(dead.input, 'heartbeatDeadMs');
  persistSeconds(heartbeat.input, 'heartbeatIntervalMs');

  duplicateInput.addEventListener('change', () => {
    void (async () => {
      const value = clampDuplicateToolCallThreshold(Number(duplicateInput.value));
      duplicateInput.value = String(value);
      const fresh = await loadSubAgentConfig();
      const ok = await saveSubAgentConfigToServer({
        ...fresh,
        duplicateToolCallThreshold: value,
      });
      setStatus(
        ok ? 'ok' : 'err',
        ok ? 'Repeated tool limit saved' : 'Could not save. Open or restart Minnow and try again.',
      );
    })();
  });
}
