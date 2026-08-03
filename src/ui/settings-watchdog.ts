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
  loadSupervisionThresholds,
  saveSupervisionThresholds,
  type SupervisionThresholds,
} from '../config/supervision-thresholds';
import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';
import { createSettingsKvList } from './settings-controls';
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
  options: { minSeconds: number; maxSeconds: number; ariaLabel: string },
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
    'When a running agent looks stuck, the watchdog steps in. Applies to sub-agents and to orchestrate task chats.',
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

  const stall = createSecondsInput(thresholds.progressStallMs, {
    minSeconds: 10,
    maxSeconds: 1800,
    ariaLabel: 'Stall timeout in seconds',
  });
  const dead = createSecondsInput(thresholds.heartbeatDeadMs, {
    minSeconds: 5,
    maxSeconds: 300,
    ariaLabel: 'Unresponsive threshold in seconds',
  });
  const heartbeat = createSecondsInput(thresholds.heartbeatIntervalMs, {
    minSeconds: 1,
    maxSeconds: 60,
    ariaLabel: 'Heartbeat interval in seconds',
  });

  const duplicateInput = document.createElement('input');
  duplicateInput.type = 'number';
  duplicateInput.className = 'settings-select settings-kv-input';
  duplicateInput.min = '0';
  duplicateInput.max = '256';
  duplicateInput.step = '1';
  duplicateInput.value = String(
    subAgents.duplicateToolCallThreshold ?? clampDuplicateToolCallThreshold(undefined),
  );
  duplicateInput.setAttribute(
    'aria-label',
    'Repeated tool calls before the run counts as looping (0 disables)',
  );

  body.appendChild(
    createSettingsKvList([
      { term: 'Stall timeout', value: stall.wrap },
      { term: 'Unresponsive after', value: dead.wrap },
      { term: 'Heartbeat interval', value: heartbeat.wrap },
      { term: 'Repeated tool limit', value: duplicateInput },
    ]),
  );

  const explain = el('div', 'settings-field-hint');
  explain.appendChild(
    el(
      'p',
      undefined,
      'Stall timeout — how long an agent may go without producing anything observable (streamed text, reasoning, or a tool call) before it counts as stuck. Long single-shot reasoning is the usual false positive; raise this if your reviewer model thinks for minutes at a time.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Unresponsive after — how long without any heartbeat at all before the run is treated as dead. This is process-level liveness, not model output, so it should stay well below the stall timeout.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Heartbeat interval — how often a running agent reports in. Lower values detect a dead run sooner at the cost of more timer wakeups.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Repeated tool limit — how many identical tool calls (same name and arguments) may occur close together before the run counts as looping. Repeats spread across a long run are ignored. Set 0 to turn loop detection off.',
    ),
  );
  body.appendChild(explain);

  const recovery = el('p', 'settings-field-hint');
  recovery.append(
    `When a run trips any of these, read-only agents are restarted from scratch, up to ${resolveSelfHealMaxRounds()} attempts per task. Agents that can write files are not auto-restarted — the task is marked blocked so you can look at it. Change the attempt cap under `,
    linkToSettingsSection('Autopilot', 'autopilot'),
    ' → Self-heal & provisioning.',
  );
  body.appendChild(recovery);

  stall.input.addEventListener('change', () => {
    const seconds = Math.min(1800, Math.max(10, Math.round(Number(stall.input.value) || 0)));
    stall.input.value = String(seconds);
    void persistThresholds({ progressStallMs: secondsToMs(seconds) });
  });
  dead.input.addEventListener('change', () => {
    const seconds = Math.min(300, Math.max(5, Math.round(Number(dead.input.value) || 0)));
    dead.input.value = String(seconds);
    void persistThresholds({ heartbeatDeadMs: secondsToMs(seconds) });
  });
  heartbeat.input.addEventListener('change', () => {
    const seconds = Math.min(60, Math.max(1, Math.round(Number(heartbeat.input.value) || 0)));
    heartbeat.input.value = String(seconds);
    void persistThresholds({ heartbeatIntervalMs: secondsToMs(seconds) });
  });
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
