/**
 * Composer hint while one or more /loop timers are active on the active chat.
 */

import {
  getActiveChat,
  getActiveLoops,
  hasActiveLoops,
} from '../state/sessions';
import { INITIAL_LOOP_AUTO_DELAY_MS } from '../chat/loop/parse-command';

function formatShortDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  return `${hours}h`;
}

/** Next due delay across all active loops on the chat. */
function nextDueLabel(now = Date.now()): string {
  const loops = getActiveLoops(getActiveChat());
  if (!loops.length) return '';
  let soonest = Infinity;
  for (const loop of loops) {
    soonest = Math.min(soonest, Math.max(0, loop.dueAt - now));
  }
  if (!Number.isFinite(soonest)) return '';
  if (soonest <= 0) return 'due now';
  return `next in ${formatShortDuration(soonest)}`;
}

/** Show or hide the active-loop strip above the composer. */
export function syncLoopActiveHint(): void {
  if (typeof document === 'undefined') return;

  let el = document.getElementById('composerLoopActiveHint');
  if (!el) {
    el = document.createElement('button');
    el.id = 'composerLoopActiveHint';
    el.type = 'button';
    el.className = 'composer-loop-active-hint hidden';
    el.setAttribute('aria-label', 'List active loops');
    el.addEventListener('click', () => {
      const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
      if (!input) return;
      input.value = '/loop list';
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const host = document.querySelector('.input-bar-composer');
    if (host) {
      // Place after the goal hint when present so both can show independently
      const goalHint = document.getElementById('composerGoalActiveHint');
      if (goalHint?.parentElement === host) {
        host.insertBefore(el, goalHint.nextSibling);
      } else {
        host.insertBefore(el, host.firstChild);
      }
    } else {
      document.body.appendChild(el);
    }
  }

  const chat = getActiveChat();
  const show = hasActiveLoops(chat);
  el.classList.toggle('hidden', !show);

  if (!show) {
    el.textContent = '';
    el.removeAttribute('title');
    return;
  }

  const loops = getActiveLoops(chat);
  const count = loops.length;
  const countLabel = count === 1 ? '1 loop' : `${count} loops`;
  const next = nextDueLabel();
  el.textContent = next ? `⟳ ${countLabel} · ${next}` : `⟳ ${countLabel}`;

  const titles = loops.map((loop) => {
    const prompt = loop.promptText.trim() || 'maintenance';
    const delay =
      loop.kind === 'interval'
        ? loop.intervalMs
        : loop.currentDelayMs ?? INITIAL_LOOP_AUTO_DELAY_MS;
    return `#${loop.id}: ${prompt} (${formatShortDuration(delay ?? 0)})`;
  });
  el.title = titles.join('\n');
}
