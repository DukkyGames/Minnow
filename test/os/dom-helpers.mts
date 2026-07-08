/** Shared happy-dom globals for OS tests under node --test. */

type HappyWindow = import('happy-dom').Window;

/** Bind browser globals from a happy-dom window onto globalThis. */
export function installHappyDomGlobals(
  win: HappyWindow,
  options?: { fetch?: typeof fetch },
): void {
  const g = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    HTMLElement: typeof HTMLElement;
    HTMLButtonElement: typeof HTMLButtonElement;
    Document: typeof Document;
    Node: typeof Node;
    localStorage: Storage;
    requestAnimationFrame: typeof requestAnimationFrame;
    getComputedStyle: typeof getComputedStyle;
    fetch?: typeof fetch;
  };
  g.window = win as unknown as Window & typeof globalThis.window;
  g.document = win.document;
  g.HTMLElement = win.HTMLElement;
  g.HTMLButtonElement = win.HTMLButtonElement;
  g.Document = win.Document;
  g.Node = win.Node;
  g.localStorage = win.localStorage;
  g.getComputedStyle = win.getComputedStyle.bind(win);
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    win.setTimeout(() => cb(win.performance.now()), 0) as unknown as number;
  win.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
  if (options?.fetch) {
    win.fetch = options.fetch;
    g.fetch = options.fetch;
  }
}

/** Inline layout so getComputedStyle returns stable line metrics in happy-dom. */
export function prepareDesktopComposerField(field: HTMLTextAreaElement): void {
  field.style.boxSizing = 'border-box';
  field.style.padding = '10px 12px';
  field.style.lineHeight = '1.35';
  field.style.fontSize = '16px';
  field.style.width = '400px';
  field.style.border = '0';
}

/** happy-dom does not lay out textarea scrollHeight; stub it for resize tests. */
export function stubTextareaScrollHeight(field: HTMLTextAreaElement, px: number): void {
  Object.defineProperty(field, 'scrollHeight', { value: px, configurable: true });
}
