/**
 * /loop command dispatch — arm, list, and stop handlers.
 */

import type { Chat } from '../../types';
import {
  addActiveLoop,
  getActiveLoops,
  hasActiveLoops,
  isGoalLoopActive,
  removeActiveLoop,
} from '../../state/sessions';
import { syncGoalActiveHint } from '../../ui/goal-active-hint';
import { syncLoopActiveHint } from '../../ui/loop-active-hint';
import {
  INITIAL_LOOP_AUTO_DELAY_MS,
  LOOP_TTL_MS,
  isNestedLoopOrGoalPrompt,
  parseLoopSlashInput,
} from './parse-command';

export type LoopCommandDispatch = 'handled' | null;

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 48) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatLoopList(chat: Chat, now = Date.now()): string {
  const loops = getActiveLoops(chat);
  if (!loops.length) {
    return 'No active loops. Use /loop 5m <prompt>, /loop <prompt>, or /loop for maintenance.';
  }

  const lines = loops.map((loop) => {
    const kindLabel =
      loop.kind === 'interval'
        ? `every ${formatDuration(loop.intervalMs ?? 0)}`
        : `auto (~${formatDuration(loop.currentDelayMs ?? INITIAL_LOOP_AUTO_DELAY_MS)})`;
    const prompt =
      loop.promptText.trim() || '(maintenance · .minnow/loop.md or built-in)';
    const nextMs = Math.max(0, loop.dueAt - now);
    const nextLabel = nextMs <= 0 ? 'due now' : `next in ${formatDuration(nextMs)}`;
    return `#${loop.id} · ${kindLabel} · ${nextLabel} · ${loop.runCount} run(s) · ${prompt}`;
  });
  return `Active loops (${loops.length}):\n${lines.join('\n')}`;
}

function syncLoopHints(): void {
  syncLoopActiveHint();
  // Goal hint shares composer strip space; refresh both so neither goes stale.
  syncGoalActiveHint();
}

/**
 * Handle `/loop` before slash-skill resolution and before `/goal`.
 * Arm/list/stop always return `handled` (composer cleared by caller).
 */
export function handleLoopCommand(
  chat: Chat,
  rawText: string,
  reportStatus: (level: 'ok' | 'err', message: string) => void,
  now = Date.now(),
): LoopCommandDispatch {
  const parsed = parseLoopSlashInput(rawText);
  if (!parsed) return null;

  if (parsed.kind === 'list') {
    reportStatus('ok', formatLoopList(chat, now));
    return 'handled';
  }

  if (parsed.kind === 'invalid') {
    reportStatus('err', parsed.message);
    return 'handled';
  }

  if (parsed.kind === 'stop') {
    if (!hasActiveLoops(chat)) {
      reportStatus('ok', 'No active loops to stop');
      return 'handled';
    }
    if (parsed.target === 'all') {
      const count = getActiveLoops(chat).length;
      removeActiveLoop(chat, 'all');
      syncLoopHints();
      reportStatus('ok', count === 1 ? 'Loop stopped' : `Stopped ${count} loops`);
      return 'handled';
    }
    const before = getActiveLoops(chat).length;
    removeActiveLoop(chat, parsed.target);
    const after = getActiveLoops(chat).length;
    if (after === before) {
      reportStatus('err', `No loop #${parsed.target}`);
      return 'handled';
    }
    syncLoopHints();
    reportStatus('ok', `Loop #${parsed.target} stopped`);
    return 'handled';
  }

  // Arm path
  if (isGoalLoopActive(chat)) {
    reportStatus('err', 'Stop the active goal first (/goal clear) before starting a loop');
    return 'handled';
  }

  if (parsed.loopKind === 'interval' && !parsed.promptText.trim()) {
    reportStatus('err', 'Add a prompt after the interval (e.g. /loop 5m check the deploy)');
    return 'handled';
  }

  if (parsed.promptText && isNestedLoopOrGoalPrompt(parsed.promptText)) {
    reportStatus('err', 'Loop prompts cannot start another /loop or /goal');
    return 'handled';
  }

  const loop = addActiveLoop(chat, {
    promptText: parsed.promptText,
    kind: parsed.loopKind,
    intervalMs: parsed.intervalMs,
    currentDelayMs:
      parsed.loopKind === 'auto' ? INITIAL_LOOP_AUTO_DELAY_MS : undefined,
    // First fire on the next ticker scan (~15s)
    dueAt: now,
    createdAt: now,
    expiresAt: now + LOOP_TTL_MS,
  });

  syncLoopHints();
  const kindLabel =
    parsed.loopKind === 'interval'
      ? `every ${formatDuration(parsed.intervalMs ?? 0)}`
      : parsed.promptText
        ? 'self-paced'
        : 'maintenance (self-paced)';
  reportStatus('ok', `Loop #${loop.id} armed · ${kindLabel}`);
  return 'handled';
}
