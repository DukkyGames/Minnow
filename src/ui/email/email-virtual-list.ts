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

/** Viewport snapshot after a scroll paint — used for infinite load and trim. */
export interface VirtualListViewport {
  firstVisible: number;
  lastVisible: number;
  nearBottom: boolean;
}

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
  /** Accessible name for the list; rows are exposed as list items. */
  ariaLabel?: string;
  /** Rendered instead of rows when the list is empty. */
  renderEmpty?: () => HTMLElement;
  /**
   * When set, this element scrolls instead of the list root. The list stays in
   * document flow and only windowed rows are mounted (inbox stream pattern).
   */
  scrollRoot?: HTMLElement;
  /** List top offset inside `scrollRoot` (px); remeasure when head content reflows. */
  listOffset?: () => number;
  /** Full row count when the backing array is a sliding window. */
  totalCount?: () => number;
  /** Global index of `items[0]` when the backing array is a sliding window. */
  indexOffset?: () => number;
  /** Fired after each paint; use for infinite load and memory trim. */
  onViewportChange?: (viewport: VirtualListViewport) => void;
  /** Distance from the list bottom that counts as near-bottom (px). */
  loadAheadPx?: number;
}): VirtualListHandle<T> {
  let items: T[] = [];

  const scrollEl = options.scrollRoot ?? null;
  const loadAheadPx = options.loadAheadPx ?? 240;

  const root = document.createElement('div');
  root.className = options.className ?? 'email-list-rows';
  if (scrollEl) {
    root.style.overflowY = 'visible';
  } else {
    root.style.overflowY = 'auto';
  }

  const padTop = document.createElement('div');
  const body = document.createElement('div');
  const padBottom = document.createElement('div');
  root.append(padTop, body, padBottom);

  let frame = 0;

  const scrollContext = (): { scrollTop: number; viewportHeight: number } => {
    if (scrollEl) {
      const listTop = options.listOffset?.() ?? 0;
      return {
        scrollTop: Math.max(0, scrollEl.scrollTop - listTop),
        viewportHeight: scrollEl.clientHeight || 600,
      };
    }
    return {
      scrollTop: root.scrollTop,
      viewportHeight: root.clientHeight || 600,
    };
  };

  const paint = (): void => {
    const globalCount = options.totalCount?.() ?? items.length;
    const baseIndex = options.indexOffset?.() ?? 0;

    if (globalCount <= 0) {
      padTop.style.height = '0px';
      padBottom.style.height = '0px';
      // Drop the list role while empty: a role="list" may only contain list
      // items, and the empty state is a plain block.
      body.removeAttribute('role');
      body.removeAttribute('aria-label');
      body.replaceChildren(options.renderEmpty?.() ?? document.createDocumentFragment());
      options.onViewportChange?.({ firstVisible: 0, lastVisible: 0, nearBottom: true });
      return;
    }

    if (items.length === 0) {
      padTop.style.height = '0px';
      padBottom.style.height = `${globalCount * options.rowHeight}px`;
      body.replaceChildren();
      options.onViewportChange?.({
        firstVisible: 0,
        lastVisible: 0,
        nearBottom: true,
      });
      return;
    }

    body.setAttribute('role', 'list');
    if (options.ariaLabel) body.setAttribute('aria-label', options.ariaLabel);

    const { scrollTop, viewportHeight } = scrollContext();

    const window_ = computeWindow({
      scrollTop,
      viewportHeight,
      rowHeight: options.rowHeight,
      itemCount: globalCount,
    });

    padTop.style.height = `${window_.padTop}px`;
    padBottom.style.height = `${window_.padBottom}px`;

    const renderStart = Math.max(window_.start, baseIndex);
    const renderEnd = Math.min(window_.end, baseIndex + items.length);

    const fragment = document.createDocumentFragment();
    for (let index = renderStart; index < renderEnd; index += 1) {
      fragment.appendChild(options.renderRow(items[index - baseIndex], index));
    }
    body.replaceChildren(fragment);

    const firstVisible = Math.floor(Math.max(0, scrollTop) / options.rowHeight);
    const lastVisible = Math.min(
      globalCount - 1,
      Math.ceil((scrollTop + viewportHeight) / options.rowHeight),
    );
    const listHeight = globalCount * options.rowHeight;
    const nearBottom = scrollTop + viewportHeight >= listHeight - loadAheadPx;
    options.onViewportChange?.({ firstVisible, lastVisible, nearBottom });
  };

  const schedulePaint = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };

  const scrollTarget = scrollEl ?? root;
  scrollTarget.addEventListener('scroll', schedulePaint, { passive: true });

  const resetScrollTop = (): void => {
    if (scrollEl) {
      scrollEl.scrollTop = 0;
    } else {
      root.scrollTop = 0;
    }
  };

  return {
    root,

    setItems(next) {
      items = next;
      resetScrollTop();
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
      const globalCount = options.totalCount?.() ?? items.length;
      if (index < 0 || index >= globalCount) return;

      const top = index * options.rowHeight;
      const bottom = top + options.rowHeight;

      if (scrollEl) {
        const listTop = options.listOffset?.() ?? 0;
        const viewTop = Math.max(0, scrollEl.scrollTop - listTop);
        const viewBottom = viewTop + scrollEl.clientHeight;
        if (top < viewTop) {
          scrollEl.scrollTop = listTop + top;
        } else if (bottom > viewBottom) {
          scrollEl.scrollTop = listTop + bottom - scrollEl.clientHeight;
        }
      } else {
        const viewTop = root.scrollTop;
        const viewBottom = viewTop + root.clientHeight;
        if (top < viewTop) {
          root.scrollTop = top;
        } else if (bottom > viewBottom) {
          root.scrollTop = bottom - root.clientHeight;
        }
      }
      paint();
    },

    destroy() {
      if (frame) cancelAnimationFrame(frame);
      scrollTarget.removeEventListener('scroll', schedulePaint);
    },
  };
}
