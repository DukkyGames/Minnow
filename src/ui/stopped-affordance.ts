import type { FailedTurnRecoveryTarget } from './failed-turn-recovery-actions';
import { appendFailedTurnRecoveryActions } from './failed-turn-recovery-actions';

export type { FailedTurnRecoveryTarget };

/** Chip inserted above an assistant bubble's body (stopped / failed states). */
function insertMessageChip(
  wrap: HTMLElement,
  modifier: string,
  chipClass: string,
  text: string,
): HTMLElement {
  wrap.classList.add(modifier);
  const existing = wrap.querySelector<HTMLElement>(`.${chipClass}`);
  if (existing) return existing;
  const chip = document.createElement('div');
  chip.className = chipClass;
  const label = document.createElement('span');
  label.textContent = text;
  chip.appendChild(label);
  const msgLabel = wrap.querySelector('.msg-label');
  if (msgLabel?.parentElement === wrap) {
    msgLabel.insertAdjacentElement('afterend', chip);
  } else {
    wrap.prepend(chip);
  }
  return chip;
}

/** User-stopped label on an assistant message row (live stream or history reload). */
export function markMessageStopped(wrap: HTMLElement): void {
  insertMessageChip(wrap, 'msg--stopped', 'msg-stopped-chip', 'Generation stopped');
}

/**
 * Partial-reply label on an assistant row the turn errored out of. The text was
 * already produced, so it stays in the transcript instead of being rolled back —
 * the chip is what tells the user the reply is incomplete.
 * When `recovery` is set (tail failed turn), Continue / Clear sit on the chip
 * so they survive a history re-render (MIN-666).
 */
export function markMessageFailed(
  wrap: HTMLElement,
  recovery?: FailedTurnRecoveryTarget,
): void {
  const chip = insertMessageChip(
    wrap,
    'msg--failed',
    'msg-failed-chip',
    'Partial reply — turn failed',
  );
  if (recovery) {
    appendFailedTurnRecoveryActions(chip, recovery);
  }
}
