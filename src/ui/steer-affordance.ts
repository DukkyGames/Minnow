/** Steer-injected user row label (live stream or history reload). */
export function markMessageSteered(wrap: HTMLElement): void {
  wrap.classList.add('msg--steered');
  if (wrap.querySelector('.msg-steer-chip')) return;
  const chip = document.createElement('div');
  chip.className = 'msg-steer-chip';
  chip.textContent = 'Steered';
  const label = wrap.querySelector('.msg-label');
  if (label?.parentElement === wrap) {
    label.insertAdjacentElement('afterend', chip);
  } else {
    wrap.prepend(chip);
  }
}
