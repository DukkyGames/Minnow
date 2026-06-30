/**
 * Goal achieved chip on history rows (analogous to steer affordance).
 */

const GOAL_ACHIEVED_CHIP_CLASS = 'msg-goal-achieved-chip';

/** Add a compact "Goal achieved" chip to a user message bubble. */
export function markMessageGoalAchieved(wrap: HTMLElement): void {
  wrap.classList.add('msg--goal-achieved');
  if (wrap.querySelector(`.${GOAL_ACHIEVED_CHIP_CLASS}`)) return;

  const chip = document.createElement('span');
  chip.className = GOAL_ACHIEVED_CHIP_CLASS;
  chip.textContent = 'Goal achieved';
  chip.setAttribute('role', 'note');

  const meta = wrap.querySelector('.msg-meta');
  if (meta) {
    meta.appendChild(chip);
    return;
  }
  wrap.appendChild(chip);
}

/** Restore goal achieved chip when rendering history. */
export function restoreGoalAchievedAffordance(
  wrap: HTMLElement,
  message: { goalAchieved?: boolean },
): void {
  if (!message.goalAchieved) return;
  markMessageGoalAchieved(wrap);
}
