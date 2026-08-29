/**
 * The handful of DOM primitives the V2 board surface uses.
 *
 * Local rather than imported from `src/ui/`: everything under `src/orchestrator`
 * is meant to survive Phase 4 deleting V1, and a helper reached across that line
 * is a dependency that quietly keeps V1 alive.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(options: {
  label: string;
  title?: string;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}): HTMLButtonElement {
  const node = el('button', 'ov2-btn', options.label);
  node.type = 'button';
  if (options.variant) node.classList.add(`ov2-btn--${options.variant}`);
  if (options.title) node.title = options.title;
  node.disabled = Boolean(options.disabled);
  node.addEventListener('click', options.onClick);
  return node;
}

/** A labelled key/value pair, for the header strip and task detail. */
export function field(label: string, value: string, extraClass?: string): HTMLElement {
  const wrap = el('div', extraClass ? `ov2-field ${extraClass}` : 'ov2-field');
  wrap.appendChild(el('span', 'ov2-field__label', label));
  wrap.appendChild(el('span', 'ov2-field__value', value));
  return wrap;
}

/** A status pill. `tone` maps onto the accent / warning / danger tokens. */
export function pill(
  text: string,
  tone: 'neutral' | 'live' | 'good' | 'warn' | 'bad' = 'neutral',
): HTMLElement {
  return el('span', `ov2-pill ov2-pill--${tone}`, text);
}

export function empty(text: string): HTMLElement {
  return el('p', 'ov2-empty', text);
}
