/**
 * Sync shell-run kill controls across the agent console and tool-call bubbles.
 */

import { stopShellRun } from '../api/stop-shell-run';
import {
  getPrimaryActiveShellRunId,
  getShellRunIdForToolCall,
  isShellRunActive,
  listActiveShellRuns,
  registerShellRun,
  subscribeShellRuns,
  unregisterShellRun,
} from './shell-run-registry';
import {
  extractShellRunIdFromToolResult,
  isKillableShellTool,
  setToolCallShellRun,
  syncToolCallKillButtons,
} from './tool-messages';

let wired = false;

function queryToolWrapByToolCallId(toolCallId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.tool-call-msg[data-tool-call-id="${CSS.escape(toolCallId)}"]`,
  );
}

function syncAgentConsoleStopButton(): void {
  const stopBtn = document.getElementById('btnTerminalAgentStop');
  const agentPane = document.getElementById('terminalAgentPane');
  if (!stopBtn || !agentPane) return;

  const onAgentTab = !agentPane.classList.contains('hidden');
  const running = listActiveShellRuns().length > 0;
  stopBtn.classList.toggle('hidden', !onAgentTab || !running);
  stopBtn.toggleAttribute('disabled', !running);
}

/** Refresh kill buttons for all tracked tool calls. */
export function refreshShellKillUi(): void {
  const activeIds = new Set(listActiveShellRuns().map((entry) => entry.runId));
  syncAgentConsoleStopButton();
  syncToolCallKillButtons(activeIds);

  for (const entry of listActiveShellRuns()) {
    if (!entry.toolCallId) continue;
    const wrap = queryToolWrapByToolCallId(entry.toolCallId);
    if (wrap) {
      setToolCallShellRun(wrap, entry.runId, true);
    }
  }
}

/** Attach kill UI for a tool call after render (live turn or history). */
export function attachShellKillUi(
  wrap: HTMLElement,
  toolName: string,
  toolCallId: string,
  args?: Record<string, unknown>,
  result?: string,
  chatId?: string,
): void {
  if (!isKillableShellTool(toolName)) return;

  wrap.dataset.toolCallId = toolCallId;

  const liveRunId = getShellRunIdForToolCall(toolCallId);
  const parsedRunId = result ? extractShellRunIdFromToolResult(toolName, result) : null;
  const runId = liveRunId ?? parsedRunId;

  if (runId) {
    const command =
      typeof args?.command === 'string' && args.command.trim()
        ? args.command.trim()
        : toolName;
    registerShellRun({
      runId,
      command,
      toolCallId,
      ...(chatId ? { chatId } : {}),
    });
    setToolCallShellRun(wrap, runId, true);
    refreshShellKillUi();
    return;
  }

  setToolCallShellRun(wrap, null, false);
}

async function stopRunFromUi(runId: string): Promise<void> {
  const ok = await stopShellRun(runId);
  if (ok) {
    unregisterShellRun(runId);
  }
  refreshShellKillUi();
}

/** Wire global listeners once (console stop + registry sync). */
export function initShellRunUi(): void {
  if (wired) return;
  wired = true;

  subscribeShellRuns(() => {
    refreshShellKillUi();
  });

  document.getElementById('btnTerminalAgentStop')?.addEventListener('click', () => {
    const runId = getPrimaryActiveShellRunId();
    if (!runId) return;
    void stopRunFromUi(runId);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLButtonElement>('.tool-call-kill');
    if (!btn || btn.disabled) return;

    const wrap = btn.closest<HTMLElement>('.tool-call-msg');
    const runId = wrap?.dataset.shellRunId?.trim();
    if (!runId || !isShellRunActive(runId)) return;

    event.preventDefault();
    event.stopPropagation();
    void stopRunFromUi(runId);
  });
}
