/**
 * Design element picker — click-to-select inside the preview guest with
 * browser_click-compatible selectors (`data-mn-uid` + CSS chain).
 * Mode-free: no hub, no agent coupling — just guest DOM selection.
 */

import { getFilePanelState } from '../state/file-panel';

/** Stable pick payload returned from the guest (JSON-cloneable). */
export interface PickedElement {
  uid: number | null;
  cssSelector: string;
  tagName: string;
  classList: string[];
  outerHTMLPreview: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  /** Condensed computed-styles digest: typography/color/spacing/layout mode. */
  stylesDigest: string;
  /** True when the pick click was shift-modified (multi-select accumulate). */
  shiftKey: boolean;
}

export interface PickerTransport {
  readonly mode: 'electron' | 'iframe';
  eval(expression: string): Promise<unknown>;
  canReadGuest(): boolean;
}

export interface ElementPickerOptions {
  transport: PickerTransport;
  onPick: (picked: PickedElement) => void | Promise<void>;
  onError?: (message: string) => void;
}

export interface ElementPicker {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isEnabled(): boolean;
  destroy(): void;
}

export const PICKER_STYLE_ID = 'mn-design-picker-style';
export const PICKER_STATE_KEY = '__mnDesignPicker';
export const PICKER_HOVER_CLASS = 'mn-design-picker-hover';

const POLL_INTERVAL_MS = 120;
const MAX_SELECTOR_DEPTH = 6;
const UNSTABLE_CLASS_RE = /^(css-|sc-|_)/;
const HASH_CLASS_RE = /[0-9a-f]{6,}/i;

/** Accent outline injected into the guest page while picking. */
const GUEST_PICKER_ACCENT = 'var(--mn-accent, #9ec5a7)';

/** In-guest enable script (single expression for execJs). */
export const PICKER_ENABLE_SCRIPT = `(() => {
  const KEY = '${PICKER_STATE_KEY}';
  const STYLE_ID = '${PICKER_STYLE_ID}';
  const HOVER = '${PICKER_HOVER_CLASS}';
  const MAX_DEPTH = ${MAX_SELECTOR_DEPTH};
  const UNSTABLE = ${UNSTABLE_CLASS_RE.toString()};
  const HASHY = ${HASH_CLASS_RE.toString()};

  if (window[KEY]) return { ok: true };

  function isStableClass(name) {
    if (!name) return false;
    if (UNSTABLE.test(name)) return false;
    if (HASHY.test(name)) return false;
    return true;
  }

  function escapeIdent(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/([.#:[\\]])/g, '\\\\$1');
  }

  function nthOfType(el) {
    const tag = el.tagName.toLowerCase();
    let n = 1;
    let sib = el;
    while ((sib = sib.previousElementSibling)) {
      if (sib.tagName.toLowerCase() === tag) n += 1;
    }
    return n;
  }

  function segmentFor(el) {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList || []).filter(isStableClass).slice(0, 2);
    let seg = tag;
    if (classes.length) seg += classes.map((c) => '.' + escapeIdent(c)).join('');
    const base = seg;
    const matches = Array.from(document.querySelectorAll(base));
    if (matches.length > 1) seg += ':nth-of-type(' + nthOfType(el) + ')';
    return seg;
  }

  function buildSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) {
      const idSel = '#' + escapeIdent(el.id);
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    }
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node !== document.documentElement && depth < MAX_DEPTH) {
      parts.unshift(segmentFor(node));
      const sel = parts.join(' > ');
      if (document.querySelectorAll(sel).length === 1 && document.querySelector(sel) === el) {
        return sel;
      }
      node = node.parentElement;
      depth += 1;
    }
    if (el.parentElement === document.body) {
      const bodySel = 'body > ' + segmentFor(el);
      if (document.querySelector(bodySel) === el) return bodySel;
    }
    const fallback = segmentFor(el);
    return fallback;
  }

  function stampUid(el, state) {
    const existing = el.getAttribute('data-mn-uid');
    if (existing) return Number(existing);
    const uid = state.nextUid++;
    el.setAttribute('data-mn-uid', String(uid));
    return uid;
  }

  function stylesDigestFor(el) {
    const cs = getComputedStyle(el);
    const family = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
    const font = cs.fontSize + '/' + cs.lineHeight + ' ' + family + ' ' + cs.fontWeight;
    let spacing = 'p:' + cs.padding + ' m:' + cs.margin;
    if (cs.gap && cs.gap !== 'normal') spacing += ' gap:' + cs.gap;
    const layout = cs.display + (cs.position && cs.position !== 'static' ? ' ' + cs.position : '');
    return ('font:' + font + '; color:' + cs.color + '; bg:' + cs.backgroundColor + '; ' + spacing + '; layout:' + layout).slice(0, 300);
  }

  function buildPayload(el, state) {
    const rect = el.getBoundingClientRect();
    const uid = stampUid(el, state);
    const cssSelector = buildSelector(el);
    const outer = (el.outerHTML || '').slice(0, 200).replace(/\\s+/g, ' ');
    return {
      uid,
      cssSelector,
      tagName: el.tagName.toLowerCase(),
      classList: Array.from(el.classList || []),
      outerHTMLPreview: outer,
      boundingRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      stylesDigest: stylesDigestFor(el),
      shiftKey: false,
    };
  }

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.' + HOVER + '{outline:2px solid ${GUEST_PICKER_ACCENT};outline-offset:-2px;cursor:crosshair !important;}';
    document.head.appendChild(style);
  }

  const state = { nextUid: 1, lastPick: null, hovered: null };
  window[KEY] = state;

  const onOver = (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (state.hovered && state.hovered !== t) state.hovered.classList.remove(HOVER);
    state.hovered = t;
    t.classList.add(HOVER);
  };

  const onOut = (ev) => {
    const t = ev.target;
    if (t instanceof Element) t.classList.remove(HOVER);
    if (state.hovered === t) state.hovered = null;
  };

  const onClick = (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    ev.preventDefault();
    ev.stopPropagation();
    state.lastPick = buildPayload(t, state);
    state.lastPick.shiftKey = !!ev.shiftKey;
  };

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('click', onClick, true);
  state.handlers = { onOver, onOut, onClick };
  return { ok: true };
})()`;

/** Poll script — returns last pick and clears it. */
export const PICKER_POLL_SCRIPT = `(() => {
  const state = window['${PICKER_STATE_KEY}'];
  if (!state || !state.lastPick) return null;
  const pick = state.lastPick;
  state.lastPick = null;
  return pick;
})()`;

/** Disable script — tears down guest picker state. */
export const PICKER_DISABLE_SCRIPT = `(() => {
  const KEY = '${PICKER_STATE_KEY}';
  const STYLE_ID = '${PICKER_STYLE_ID}';
  const HOVER = '${PICKER_HOVER_CLASS}';
  const state = window[KEY];
  if (state && state.handlers) {
    document.removeEventListener('mouseover', state.handlers.onOver, true);
    document.removeEventListener('mouseout', state.handlers.onOut, true);
    document.removeEventListener('click', state.handlers.onClick, true);
    if (state.hovered instanceof Element) state.hovered.classList.remove(HOVER);
  }
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
  delete window[KEY];
  return { ok: true };
})()`;

/** Exported alias for unit tests (enable script). */
export const PICKER_CAPTURE_SCRIPT = PICKER_ENABLE_SCRIPT;

/** True when a CSS class name is stable enough for selector building. */
export function isStablePickerClass(className: string): boolean {
  if (!className) return false;
  if (UNSTABLE_CLASS_RE.test(className)) return false;
  if (HASH_CLASS_RE.test(className)) return false;
  return true;
}

function escapeCssIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([.#:[\]])/g, '\\$1');
}

function nthOfTypeIndex(el: Element): number {
  const tag = el.tagName.toLowerCase();
  let index = 1;
  let sibling: Element | null = el;
  while ((sibling = sibling.previousElementSibling)) {
    if (sibling.tagName.toLowerCase() === tag) index += 1;
  }
  return index;
}

function segmentForElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter(isStablePickerClass).slice(0, 2);
  let segment = tag;
  if (classes.length) {
    segment += classes.map((name) => `.${escapeCssIdent(name)}`).join('');
  }
  const base = segment;
  const doc = el.ownerDocument;
  if (doc.querySelectorAll(base).length > 1) {
    segment += `:nth-of-type(${nthOfTypeIndex(el)})`;
  }
  return segment;
}

/**
 * Pure selector builder mirrored from the in-guest script (unit-tested with jsdom/happy-dom).
 * Always stamps `data-mn-uid` on the element when `nextUid` is provided.
 */
export function buildCssSelectorForElement(
  doc: Document,
  el: Element,
  options?: { maxDepth?: number; nextUid?: number },
): { cssSelector: string; uid: number | null } {
  const maxDepth = options?.maxDepth ?? MAX_SELECTOR_DEPTH;
  let uid: number | null = null;

  if (options?.nextUid != null) {
    const existing = el.getAttribute('data-mn-uid');
    if (existing) {
      uid = Number(existing);
    } else {
      uid = options.nextUid;
      el.setAttribute('data-mn-uid', String(uid));
    }
  } else {
    const existing = el.getAttribute('data-mn-uid');
    uid = existing ? Number(existing) : null;
  }

  if (el.id) {
    const idSelector = `#${escapeCssIdent(el.id)}`;
    if (doc.querySelectorAll(idSelector).length === 1) {
      return { cssSelector: idSelector, uid };
    }
  }

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== doc.documentElement && depth < maxDepth) {
    parts.unshift(segmentForElement(node));
    const selector = parts.join(' > ');
    if (doc.querySelectorAll(selector).length === 1 && doc.querySelector(selector) === el) {
      return { cssSelector: selector, uid };
    }
    node = node.parentElement;
    depth += 1;
  }

  if (el.parentElement === doc.body) {
    const bodySelector = `body > ${segmentForElement(el)}`;
    if (doc.querySelector(bodySelector) === el) {
      return { cssSelector: bodySelector, uid };
    }
  }

  return { cssSelector: segmentForElement(el), uid };
}

/** Guaranteed-unique fallback selector used by browser_click. */
export function uidFallbackSelector(uid: number): string {
  return `[data-mn-uid="${uid}"]`;
}

/**
 * Condensed computed-styles digest: typography/color/spacing/layout mode.
 * Pure DOM read (unit-tested with happy-dom); mirrors the in-guest
 * `stylesDigestFor` computed in {@link PICKER_ENABLE_SCRIPT}.
 */
export function buildStylesDigestForElement(el: Element): string {
  const view = el.ownerDocument.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return '';
  const cs = view.getComputedStyle(el);
  const family = (cs.fontFamily || '').split(',')[0]?.replace(/["']/g, '').trim() || '';
  const font = `${cs.fontSize}/${cs.lineHeight} ${family} ${cs.fontWeight}`;
  let spacing = `p:${cs.padding} m:${cs.margin}`;
  if (cs.gap && cs.gap !== 'normal') spacing += ` gap:${cs.gap}`;
  const layout = `${cs.display}${cs.position && cs.position !== 'static' ? ` ${cs.position}` : ''}`;
  return `font:${font}; color:${cs.color}; bg:${cs.backgroundColor}; ${spacing}; layout:${layout}`.slice(
    0,
    300,
  );
}

function unwrapExecJsResult(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && '__execError' in (raw as Record<string, unknown>)) {
    const message = String((raw as { __execError?: unknown }).__execError ?? 'Script failed');
    throw new Error(message);
  }
  return raw;
}

function getPreviewFrame(): HTMLIFrameElement | null {
  return document.getElementById('previewFrame') as HTMLIFrameElement | null;
}

function isCrossOriginPreview(): boolean {
  const source = getFilePanelState().previewSource;
  if (!source || source.kind !== 'url') return false;
  try {
    const origin = new URL(source.url).origin;
    return origin !== window.location.origin;
  } catch {
    return true;
  }
}

/** Detect Electron execJs vs iframe guest access. */
export function createPickerTransport(): PickerTransport {
  const preview = window.minnow?.preview;
  if (preview && typeof preview.execJs === 'function') {
    return {
      mode: 'electron',
      async eval(expression: string): Promise<unknown> {
        const raw = await preview.execJs(expression);
        return unwrapExecJsResult(raw);
      },
      canReadGuest(): boolean {
        return true;
      },
    };
  }

  const frame = getPreviewFrame();
  let guestReadable = false;
  if (frame) {
    try {
      const win = frame.contentWindow;
      if (win) {
        void win.document;
        guestReadable = true;
      }
    } catch {
      guestReadable = false;
    }
  }
  void guestReadable;

  return {
    mode: 'iframe',
    async eval(expression: string): Promise<unknown> {
      const iframe = getPreviewFrame();
      const win = iframe?.contentWindow;
      if (!win) throw new Error('Preview iframe unavailable');
      try {
        const guestWindow = win as Window & { eval: (expr: string) => unknown };
        return guestWindow.eval(expression);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(message);
      }
    },
    canReadGuest(): boolean {
      const iframe = getPreviewFrame();
      if (!iframe) return false;
      try {
        const win = iframe.contentWindow;
        if (!win) return false;
        void win.document;
        return true;
      } catch {
        return false;
      }
    },
  };
}

function normalizePickedElement(raw: unknown): PickedElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const rect = row.boundingRect as Record<string, unknown> | undefined;
  if (!rect || typeof rect !== 'object') return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;

  const classList = Array.isArray(row.classList)
    ? row.classList.filter((c): c is string => typeof c === 'string')
    : [];

  return {
    uid: row.uid == null ? null : Number(row.uid),
    cssSelector: typeof row.cssSelector === 'string' ? row.cssSelector : '',
    tagName: typeof row.tagName === 'string' ? row.tagName : 'element',
    classList,
    outerHTMLPreview:
      typeof row.outerHTMLPreview === 'string' ? row.outerHTMLPreview : '',
    boundingRect: { x, y, width, height },
    devicePixelRatio:
      typeof row.devicePixelRatio === 'number' && Number.isFinite(row.devicePixelRatio)
        ? row.devicePixelRatio
        : 1,
    stylesDigest: typeof row.stylesDigest === 'string' ? row.stylesDigest : '',
    shiftKey: row.shiftKey === true,
  };
}

/** Factory for the Design Mode element picker. */
export function createElementPicker(options: ElementPickerOptions): ElementPicker {
  const { transport, onPick, onError } = options;
  let enabled = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let iframeClickHandler: ((ev: MouseEvent) => void) | null = null;

  function stopPoll(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce(): Promise<void> {
    try {
      const raw = await transport.eval(PICKER_POLL_SCRIPT);
      const picked = normalizePickedElement(raw);
      if (picked) await Promise.resolve(onPick(picked));
    } catch {
      /* guest may be mid-navigation */
    }
  }

  function startPoll(): void {
    stopPoll();
    pollTimer = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
  }

  function attachIframeDirectClick(): void {
    if (transport.mode !== 'iframe') return;
    const frame = getPreviewFrame();
    const doc = frame?.contentDocument;
    if (!doc) return;

    iframeClickHandler = (ev: MouseEvent) => {
      // The target belongs to the guest iframe's realm, so a parent-realm
      // `instanceof Element` check is always false (each same-origin frame has
      // its own Element constructor). Duck-type on nodeType instead, which is
      // realm-independent.
      const target = ev.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = target.getBoundingClientRect();
      const { cssSelector, uid } = buildCssSelectorForElement(doc, target, { nextUid: 1 });
      void Promise.resolve(
        onPick({
          uid,
          cssSelector,
          tagName: target.tagName.toLowerCase(),
          classList: Array.from(target.classList),
          outerHTMLPreview: (target.outerHTML || '').slice(0, 200).replace(/\s+/g, ' '),
          boundingRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          devicePixelRatio: frame?.contentWindow?.devicePixelRatio ?? 1,
          stylesDigest: buildStylesDigestForElement(target),
          shiftKey: ev.shiftKey,
        }),
      );
    };

    doc.addEventListener('click', iframeClickHandler, true);
  }

  function detachIframeDirectClick(): void {
    if (!iframeClickHandler) return;
    const frame = getPreviewFrame();
    frame?.contentDocument?.removeEventListener('click', iframeClickHandler, true);
    iframeClickHandler = null;
  }

  return {
    async enable(): Promise<void> {
      if (enabled) return;
      if (isCrossOriginPreview() || !transport.canReadGuest()) {
        onError?.('cross-origin preview: element picker disabled, use region draw');
        return;
      }
      try {
        await transport.eval(PICKER_ENABLE_SCRIPT);
        if (transport.mode === 'iframe') {
          attachIframeDirectClick();
        } else {
          startPoll();
        }
        enabled = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onError?.(message);
      }
    },

    async disable(): Promise<void> {
      if (!enabled) return;
      stopPoll();
      detachIframeDirectClick();
      try {
        await transport.eval(PICKER_DISABLE_SCRIPT);
      } catch {
        /* guest may be gone */
      }
      enabled = false;
    },

    isEnabled(): boolean {
      return enabled;
    },

    destroy(): void {
      void this.disable();
    },
  };
}
