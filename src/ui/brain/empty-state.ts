/**
 * Shared empty / loading / offline blocks for Brain app sections.
 */

export type BrainEmptyIcon = 'inbox' | 'search' | 'graph' | 'file' | 'sparkle' | 'offline';

const ICON_PATHS: Record<BrainEmptyIcon, string> = {
  inbox:
    '<path d="M22 12h-6l-2 3H10l-2-3H4"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  graph:
    '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5 10.5 16M16.5 7.5 13.5 16M8 6h8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  sparkle: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"/>',
  offline: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
};

export interface BrainEmptyStateOptions {
  icon?: BrainEmptyIcon;
  title: string;
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
}

/** Render a framed empty state into a mount element. */
export function renderBrainEmptyState(
  mount: HTMLElement,
  options: BrainEmptyStateOptions,
): void {
  mount.replaceChildren();
  const block = document.createElement('div');
  block.className = 'brain-empty-state';

  const icon = document.createElement('div');
  icon.className = 'brain-empty-state__icon';
  icon.setAttribute('aria-hidden', 'true');
  const iconKey = options.icon ?? 'inbox';
  icon.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24">${ICON_PATHS[iconKey]}</svg>`;
  block.append(icon);

  const title = document.createElement('h3');
  title.className = 'brain-empty-state__title';
  title.textContent = options.title;
  block.append(title);

  const message = document.createElement('p');
  message.className = 'brain-empty-state__message';
  message.textContent = options.message;
  block.append(message);

  if (options.ctaLabel && options.onCta) {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'brain-action-btn is-primary';
    cta.textContent = options.ctaLabel;
    cta.addEventListener('click', options.onCta);
    block.append(cta);
  }

  mount.append(block);
}

/** Show a compact loading row with spinner. */
export function renderBrainLoading(mount: HTMLElement, message: string): void {
  mount.replaceChildren();
  const row = document.createElement('div');
  row.className = 'brain-loading';
  row.setAttribute('role', 'status');
  const spinner = document.createElement('span');
  spinner.className = 'brain-loading__spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = message;
  row.append(spinner, text);
  mount.append(row);
}
