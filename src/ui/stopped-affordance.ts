/** User-stopped label on an assistant message row (live stream or history reload). */
export function markMessageStopped(wrap: HTMLElement): void {
  wrap.classList.add('msg--stopped');
  if (wrap.querySelector('.msg-stopped-chip')) return;
  const chip = document.createElement('div');
  chip.className = 'msg-stopped-chip';
  chip.textContent = 'Generation stopped';
  const label = wrap.querySelector('.msg-label');
  if (label?.parentElement === wrap) {
    label.insertAdjacentElement('afterend', chip);
  } else {
    wrap.prepend(chip);
  }
}
