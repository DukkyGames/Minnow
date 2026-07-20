/**
 * Windowed list rendering.
 *
 * The message list used to build every row on every action; at 200 rows that is
 * already a visible hitch, and the conversation list is meant to hold
 * thousands. Only the rows inside the viewport (plus an overscan margin) exist
 * in the DOM; spacers above and below keep the scrollbar honest.
 *
 * Rows are assumed to be a uniform height, which they are — the row style fixes
 * it. That keeps the maths exact and avoids a measurement pass.
 */

/** Rows rendered beyond each edge of the viewport, to cover fast scrolling. */
export const OVERSCAN_ROWS = 10;

export interface VirtualListHandle<T> {
  root: HTMLElement;
  /** Replace the contents and jump back to the top (a new folder or query). */
  setItems(items: T[]): void;
  /**
   * Swap the items without moving the viewport — for an optimistic edit, where
   * scrolling back to the top would throw away the user's place.
   */
  updateItems(items: T[]): void;
  /** Repaint in place, keeping scroll position (after a flag change, say). */
  refresh(): void;
  /** Bring an index into view, scrolling only if it is outside. */
  scrollToIndex(index: number): void;
  destroy(): void;
}

/**
 * Compute the slice to render for a scroll position.
 * Exported for tests: the arithmetic is where an off-by-one hides.
 */
export function computeWindow(options: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  itemCount: number;
  overscan?: number;
}): { start: number; end: number; padTop: number; padBottom: number } {
  const { scrollTop, viewportHeight, rowHeight, itemCount } = options;
  const overscan = options.overscan ?? OVERSCAN_ROWS;

  if (rowHeight <= 0 || itemCount <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }

  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;

  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(itemCount, firstVisible + visibleCount + overscan);

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (itemCount - end) * rowHeight),
  };
}

export function createVirtualList<T>(options: {
  rowHeight: number;
  renderRow: (item: T, index: number) => HTMLElement;
  className?: string;
  /** Rendered instead of rows when the list is empty. */
  renderEmpty?: () => HTMLElement;
}): VirtualListHandle<T> {
  let items: T[] = [];

  const root = document.createElement('div');
  root.className = options.className ?? 'email-list-rows';
  root.style.overflowY = 'auto';

  const padTop = document.createElement('div');
  const body = document.createElement('div');
  const padBottom = document.createElement('div');
  root.append(padTop, body, padBottom);

  let frame = 0;

  const paint = (): void => {
    if (items.length === 0) {
      padTop.style.height = '0px';
      padBottom.style.height = '0px';
      body.replaceChildren(options.renderEmpty?.() ?? document.createDocumentFragment());
      return;
    }

    const window_ = computeWindow({
      scrollTop: root.scrollTop,
      // Before the element is laid out clientHeight is 0, which would render
      // an empty window; fall back to a screenful so the first paint is real.
      viewportHeight: root.clientHeight || 600,
      rowHeight: options.rowHeight,
      itemCount: items.length,
    });

    padTop.style.height = `${window_.padTop}px`;
    padBottom.style.height = `${window_.padBottom}px`;

    const fragment = document.createDocumentFragment();
    for (let index = window_.start; index < window_.end; index += 1) {
      fragment.appendChild(options.renderRow(items[index], index));
    }
    body.replaceChildren(fragment);
  };

  const schedulePaint = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };

  root.addEventListener('scroll', schedulePaint, { passive: true });

  return {
    root,

    setItems(next) {
      items = next;
      root.scrollTop = 0;
      paint();
    },

    updateItems(next) {
      items = next;
      paint();
    },

    refresh() {
      paint();
    },

    scrollToIndex(index) {
      if (index < 0 || index >= items.length) return;
      const top = index * options.rowHeight;
      const bottom = top + options.rowHeight;
      const viewTop = root.scrollTop;
      const viewBottom = viewTop + root.clientHeight;

      // Only move if the row is actually out of view — scrolling a row that is
      // already visible makes keyboard navigation feel like it is fighting you.
      if (top < viewTop) {
        root.scrollTop = top;
      } else if (bottom > viewBottom) {
        root.scrollTop = bottom - root.clientHeight;
      }
      paint();
    },

    destroy() {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener('scroll', schedulePaint);
    },
  };
}
