/**
 * Host UI when a reef widget fails iframe validation before display.
 */

/** Build the error panel shown instead of a broken iframe. */
export function createReefWidgetErrorPanel(errors: string[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'reef-widget-error';
  panel.setAttribute('role', 'alert');

  const title = document.createElement('div');
  title.className = 'reef-widget-error__title';
  title.textContent = 'Widget could not be displayed';

  const list = document.createElement('ul');
  list.className = 'reef-widget-error__list';

  const unique = [...new Set(errors.map((e) => e.trim()).filter(Boolean))];
  const lines = unique.length > 0 ? unique : ['The widget did not render correctly.'];
  for (const line of lines) {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  }

  const hint = document.createElement('p');
  hint.className = 'reef-widget-error__hint';
  hint.textContent =
    'Ask the assistant to fix the reef-widget fence (syntax, imports, or theme tokens) and try again.';

  panel.appendChild(title);
  panel.appendChild(list);
  panel.appendChild(hint);
  return panel;
}

/** Status row while the host probes the sandboxed iframe for runtime errors. */
export function createReefWidgetValidatingStatus(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'reef-widget-validating-status';
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
  label.textContent = 'Checking widget…';

  row.appendChild(dots);
  row.appendChild(label);
  return row;
}
