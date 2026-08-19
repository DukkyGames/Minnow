/**
 * DOM for the Load-tab launch memory instrument.
 *
 * The Load tab replaces this cluster on each slider tick (the range inputs
 * stay mounted). Fills are instant: no 0→value animation on a reused node.
 */

import {
  buildLaunchMemoryMeterView,
  type LaunchMemoryMeterInput,
  type LaunchMemoryMeterRow,
} from '../../models/launch-memory-meter';
import { el } from './dom';

function meterRow(row: LaunchMemoryMeterRow): HTMLElement {
  const wrap = el('div', 'models-launch-memory__row');
  wrap.dataset.tone = row.tone;
  wrap.dataset.kind = row.id;

  const kind = el('span', 'models-launch-memory__kind', row.label);
  const value = el('span', 'models-launch-memory__value', row.valueText);
  wrap.append(kind, value);

  const track = el('div', 'models-launch-memory__track');
  // Occupancy is only a meter when we have a hardware budget to compare against.
  if (row.budgetGb != null && row.ratio != null) {
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', row.label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(row.budgetGb));
    track.setAttribute('aria-valuenow', String(row.usedGb));
    const over = row.tone === 'over' ? ', over budget' : row.tone === 'tight' ? ', tight' : '';
    track.setAttribute('aria-valuetext', `${row.valueText}${over}`);
  } else {
    track.setAttribute('aria-hidden', 'true');
  }

  const fill = el('div', 'models-launch-memory__fill');
  fill.setAttribute('aria-hidden', 'true');
  fill.style.setProperty('--fill', String(row.fill));
  track.appendChild(fill);
  wrap.appendChild(track);
  return wrap;
}

/** Occupancy cluster that replaced the plain `Estimated memory at launch` paragraph. */
export function renderLaunchMemoryMeter(input: LaunchMemoryMeterInput): HTMLElement {
  const view = buildLaunchMemoryMeterView(input);
  const root = el('div', 'models-launch-memory models-launch-memory-hint');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', view.ariaLabel);
  if (view.tight) root.classList.add('models-launch-memory--tight');
  if (view.title) root.title = view.title;

  for (const row of view.rows) {
    root.appendChild(meterRow(row));
  }

  if (view.kvNote) {
    root.appendChild(el('p', 'models-launch-memory__note', view.kvNote));
  }
  if (view.caption) {
    const caption = el('p', 'models-launch-memory__caption', view.caption);
    caption.classList.toggle('models-launch-memory__caption--warn', view.tight);
    root.appendChild(caption);
  }
  return root;
}
