/** Chip inserted above an assistant bubble's body (stopped / failed states). */
function insertMessageChip(
  wrap: HTMLElement,
  modifier: string,
  chipClass: string,
  text: string,
): void {
  wrap.classList.add(modifier);
  if (wrap.querySelector(`.${chipClass}`)) return;
  const chip = document.createElement('div');
  chip.className = chipClass;
  chip.textContent = text;
  const label = wrap.querySelector('.msg-label');
  if (label?.parentElement === wrap) {
    label.insertAdjacentElement('afterend', chip);
  } else {
    wrap.prepend(chip);
  }
}

/** User-stopped label on an assistant message row (live stream or history reload). */
export function markMessageStopped(wrap: HTMLElement): void {
  insertMessageChip(wrap, 'msg--stopped', 'msg-stopped-chip', 'Generation stopped');
}

/**
 * Partial-reply label on an assistant row the turn errored out of. The text was
 * already produced, so it stays in the transcript instead of being rolled back —
 * the chip is what tells the user the reply is incomplete.
 */
export function markMessageFailed(wrap: HTMLElement): void {
  insertMessageChip(wrap, 'msg--failed', 'msg-failed-chip', 'Partial reply — turn failed');
}
