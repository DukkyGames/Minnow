import { appendSettingsGroup, linkToSettingsSection } from './settings-layout';

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

/** Note under generation timeouts: sub-agents are recovered by reconcile, not by the deleted heartbeat/stall supervisor. */
export async function renderAgentSupervisionSection(
  mount: HTMLElement,
  options?: { emphasis?: boolean },
): Promise<void> {
  const body = appendSettingsGroup(
    mount,
    'Sub-agent recovery',
    'A crashed or timed-out sub-agent is retried from the journal. There is no heartbeat, stall timer, or repeated-tool watchdog.',
    'agents.watchdog.supervision',
    options?.emphasis ? { emphasis: true } : undefined,
  );

  const notes = el('div', 'settings-watchdog-supervision__notes');
  const explain = el('div', 'settings-field-hint');
  explain.appendChild(
    el(
      'p',
      undefined,
      'Wall-clock budget for one sub-agent attempt is Settings → Agents → Sub-agents (default timeout and per-type timeout). A timeout is a typed exit; policy retries with a continue seed instead of discarding the work.',
    ),
  );
  explain.appendChild(
    el(
      'p',
      undefined,
      'Generation timeouts above still apply to the model stream itself (idle and max duration).',
    ),
  );
  notes.appendChild(explain);

  const recovery = el('p', 'settings-field-hint');
  recovery.append(
    'Change sub-agent concurrency and timeouts under ',
    linkToSettingsSection('Sub-agents', 'sub-agents'),
    '.',
  );
  notes.appendChild(recovery);
  body.appendChild(notes);
}
