/**
 * While the assistant bubble is streaming, replace visible reef-widget fence code
 * with a short status row (phase label + loading dots).
 */

/** Heuristic phase from partial fence body (see reef.full.md streaming order). */
export type ReefWidgetBuildPhase = 'building' | 'styling' | 'finishing';

const LABEL_BY_PHASE: Record<ReefWidgetBuildPhase, string> = {
  building: 'Building widget…',
  styling: 'Styling…',
  finishing: 'Finishing up…',
};

const PENDING_STATUS_CLASS = 'reef-widget-pending-status';

/**
 * Infer build phase from fence body text (see reef.full.md: style, markup, script).
 * Used only while the bubble is streaming; iframe mounts after the final render.
 */
export function inferReefWidgetBuildPhase(codeText: string): ReefWidgetBuildPhase {
  const t = codeText.toLowerCase();
  if (!t.includes('<style')) return 'building';
  if (!t.includes('<script')) return 'styling';
  return 'finishing';
}

/** Human-readable label for the pending row (for tests and a11y). */
export function reefWidgetPendingLabel(phase: ReefWidgetBuildPhase): string {
  return LABEL_BY_PHASE[phase];
}

/**
 * Mark the `<pre>` as pending and inject/update a status row (dots + label).
 * Keeps `<code>` in the DOM; CSS hides it while pending.
 */
export function applyReefWidgetPendingUi(
  pre: HTMLPreElement,
  phase: ReefWidgetBuildPhase,
): void {
  pre.classList.add('reef-widget-pre--pending');

  let row = pre.querySelector<HTMLElement>(`.${PENDING_STATUS_CLASS}`);
  if (!row) {
    row = document.createElement('div');
    row.className = PENDING_STATUS_CLASS;
    row.setAttribute('role', 'status');
    row.setAttribute('aria-live', 'polite');
    row.setAttribute('aria-busy', 'true');

    const dots = document.createElement('span');
    dots.className = 'reef-widget-pending__dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'reef-widget-pending__dot';
      dots.appendChild(dot);
    }

    const label = document.createElement('span');
    label.className = 'reef-widget-pending__label';

    row.appendChild(dots);
    row.appendChild(label);
    pre.insertBefore(row, pre.firstChild);
  }

  const labelEl = row.querySelector('.reef-widget-pending__label');
  if (labelEl) {
    labelEl.textContent = LABEL_BY_PHASE[phase];
  }
}
