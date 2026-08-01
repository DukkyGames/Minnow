/**
 * Design element picker — click-to-select inside the preview guest with
 * browser_click-compatible selectors (`data-mn-uid` + CSS chain).
 * Mode-free: no hub, no agent coupling — just guest DOM selection.
 */

import { previewSourceForDesignInstance } from '../ui/preview-design-source';
import { isDesignModeUsingIframeGuest } from '../ui/preview-design-mode-guest';
import { WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID } from '../ui/preview-design-mode-mount';
import { WORKSPACE_PREVIEW_SECONDARY_INSTANCE } from '../ui/right-pane-split';

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
  /** A11y quick-pass (MIN-370): aria-label || alt || trimmed text content, capped at 160 chars. */
  accessibleName: string;
  /** A11y quick-pass (MIN-370): WCAG contrast ratio of color vs background, or null when it can't be computed (e.g. transparent background). */
  contrastRatio: number | null;
  /** Readable ancestor chain up to the root, e.g. `div#root > main.page > button.cta`. */
  domPath: string;
  /** Every attribute on the picked element (name → value); our own `data-mn-uid` stamp is omitted. */
  attributes: Record<string, string>;
  /** Curated computed styles (camelCase key → value) — the fuller detail behind {@link stylesDigest}. */
  computedStyles: Record<string, string>;
}

/**
 * Computed-style properties captured per pick as `[outputKey, cssProperty]`. Kept curated (not
 * the whole `getComputedStyle` dump) so the chat block stays readable and bounded. Mirrored into
 * the in-guest capture script via JSON interpolation and reused by the iframe/CDP paths.
 */
export const COMPUTED_STYLE_PROPS: ReadonlyArray<readonly [string, string]> = [
  ['color', 'color'],
  ['backgroundColor', 'background-color'],
  ['fontSize', 'font-size'],
  ['fontFamily', 'font-family'],
  ['fontWeight', 'font-weight'],
  ['lineHeight', 'line-height'],
  ['letterSpacing', 'letter-spacing'],
  ['textAlign', 'text-align'],
  ['display', 'display'],
  ['position', 'position'],
  ['flexDirection', 'flex-direction'],
  ['justifyContent', 'justify-content'],
  ['alignItems', 'align-items'],
  ['gap', 'gap'],
  ['padding', 'padding'],
  ['margin', 'margin'],
  ['border', 'border'],
  ['borderRadius', 'border-radius'],
  ['boxShadow', 'box-shadow'],
  ['opacity', 'opacity'],
  ['zIndex', 'z-index'],
];

/** Max ancestor depth walked when building the readable {@link PickedElement.domPath}. */
const DOM_PATH_MAX_DEPTH = 12;

/** Cap per attribute value so a huge inline `style`/`srcset` can't bloat the chat block. */
const ATTR_VALUE_MAX = 200;

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

  function accessibleNameFor(el) {
    const ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) return ariaLabel.slice(0, 160);
    const alt = (el.getAttribute('alt') || '').trim();
    if (alt) return alt.slice(0, 160);
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 160);
  }

  function domPathFor(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && node !== document.body && depth < ${DOM_PATH_MAX_DEPTH}) {
      let seg = node.tagName.toLowerCase();
      if (node.id) seg += '#' + node.id;
      else {
        const cls = Array.from(node.classList || []).filter((c) => c !== HOVER).slice(0, 2);
        if (cls.length) seg += cls.map((c) => '.' + c).join('');
      }
      parts.unshift(seg);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function attributesFor(el) {
    const out = {};
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a.name === 'data-mn-uid') continue;
      let value = a.value;
      if (a.name === 'class') {
        value = value.split(/\\s+/).filter((c) => c && c !== HOVER).join(' ');
        if (!value) continue;
      }
      out[a.name] = value.length > ${ATTR_VALUE_MAX} ? value.slice(0, ${ATTR_VALUE_MAX}) + '…' : value;
    }
    return out;
  }

  function computedStylesFor(el) {
    const cs = getComputedStyle(el);
    const out = {};
    const props = ${JSON.stringify(COMPUTED_STYLE_PROPS)};
    for (let i = 0; i < props.length; i++) {
      const v = (cs.getPropertyValue(props[i][1]) || '').trim();
      if (v) out[props[i][0]] = v;
    }
    return out;
  }

  function parseCssColorGuest(value) {
    const trimmed = (value || '').trim();
    if (!trimmed || trimmed === 'transparent') return null;
    const m = /^rgba?\\(([^)]+)\\)$/i.exec(trimmed);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function linearChannelGuest(c) {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function relativeLuminanceGuest(rgb) {
    return 0.2126 * linearChannelGuest(rgb.r) + 0.7152 * linearChannelGuest(rgb.g) + 0.0722 * linearChannelGuest(rgb.b);
  }

  function contrastRatioFor(digest) {
    const cm = /color:([^;]+);/.exec(digest);
    const bm = /bg:([^;]+);/.exec(digest);
    if (!cm || !bm) return null;
    const fg = parseCssColorGuest(cm[1]);
    const bg = parseCssColorGuest(bm[1]);
    if (!fg || !bg || bg.a === 0) return null;
    const l1 = relativeLuminanceGuest(fg);
    const l2 = relativeLuminanceGuest(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
  }

  function buildPayload(el, state) {
    const rect = el.getBoundingClientRect();
    const uid = stampUid(el, state);
    const cssSelector = buildSelector(el);
    const outer = (el.outerHTML || '').slice(0, 200).replace(/\\s+/g, ' ');
    const stylesDigest = stylesDigestFor(el);
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
      stylesDigest,
      shiftKey: false,
      accessibleName: accessibleNameFor(el),
      contrastRatio: contrastRatioFor(stylesDigest),
      domPath: domPathFor(el),
      attributes: attributesFor(el),
      computedStyles: computedStylesFor(el),
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

/**
 * Readable ancestor chain for an element, e.g. `div#root > main.page > button.cta`. Prefers an
 * id per segment, otherwise the first stable-ish classes; the picker's own hover class is
 * skipped. Mirrors the in-guest `domPathFor` in {@link PICKER_ENABLE_SCRIPT}.
 */
export function buildDomPathForElement(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (
    node &&
    node.nodeType === 1 &&
    node !== doc.documentElement &&
    node !== doc.body &&
    depth < DOM_PATH_MAX_DEPTH
  ) {
    let segment = node.tagName.toLowerCase();
    if (node.id) {
      segment += `#${node.id}`;
    } else {
      const classes = Array.from(node.classList)
        .filter((name) => name !== PICKER_HOVER_CLASS)
        .slice(0, 2);
      if (classes.length) segment += classes.map((name) => `.${name}`).join('');
    }
    parts.unshift(segment);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(' > ');
}

/**
 * Every attribute on an element (name → value), minus our own `data-mn-uid` stamp and the
 * picker's transient hover class. Long values are capped. Mirrors the in-guest `attributesFor`.
 */
export function attributesForElement(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'data-mn-uid') continue;
    let value = attr.value;
    if (attr.name === 'class') {
      value = value
        .split(/\s+/)
        .filter((name) => name && name !== PICKER_HOVER_CLASS)
        .join(' ');
      if (!value) continue;
    }
    out[attr.name] = value.length > ATTR_VALUE_MAX ? `${value.slice(0, ATTR_VALUE_MAX)}…` : value;
  }
  return out;
}

/**
 * Curated computed styles ({@link COMPUTED_STYLE_PROPS}) as a camelCase key → value record.
 * Mirrors the in-guest `computedStylesFor`; unit-tested with happy-dom.
 */
export function computedStylesForElement(el: Element): Record<string, string> {
  const view = el.ownerDocument.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return {};
  const cs = view.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const [key, prop] of COMPUTED_STYLE_PROPS) {
    const value = (cs.getPropertyValue(prop) || '').trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Parsed sRGB color channels (0-255) plus alpha (0-1). */
export interface ParsedRgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse a computed-style color string (`rgb(...)`, `rgba(...)`, or `#hex`) into channels.
 * Returns null for `transparent`/unparseable values — the caller treats that as "can't compute
 * contrast reliably" rather than guessing at an ancestor's background.
 */
export function parseCssColor(value: string): ParsedRgbColor | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'transparent') return null;

  const rgbaMatch = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]!.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts.length > 3 ? parts[3]! : 1 };
  }

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 1 };
  }

  return null;
}

function srgbChannelToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB color (0..1). */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return (
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  );
}

/** WCAG contrast ratio between two sRGB colors, always >= 1. */
export function contrastRatioOf(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A11y quick-pass (MIN-370): parse `color:`/`bg:` out of an element-picker stylesDigest string
 * (cheap — no extra DOM read, the digest is already computed) and return the WCAG contrast ratio.
 * Null when either color is missing/unparseable or the background is fully transparent (can't
 * compute reliably without walking ancestors for an opaque background).
 */
export function computeContrastRatioFromStylesDigest(stylesDigest: string): number | null {
  const colorMatch = /color:([^;]+);/.exec(stylesDigest);
  const bgMatch = /bg:([^;]+);/.exec(stylesDigest);
  if (!colorMatch || !bgMatch) return null;
  const fg = parseCssColor(colorMatch[1]!.trim());
  const bg = parseCssColor(bgMatch[1]!.trim());
  if (!fg || !bg || bg.a === 0) return null;
  return Math.round(contrastRatioOf(fg, bg) * 100) / 100;
}

/** A11y quick-pass (MIN-370): aria-label || alt || trimmed text content, capped at 160 chars. */
export function computeAccessibleNameForElement(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel.slice(0, 160);
  const alt = el.getAttribute('alt')?.trim();
  if (alt) return alt.slice(0, 160);
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
  return text.slice(0, 160);
}

function unwrapExecJsResult(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && '__execError' in (raw as Record<string, unknown>)) {
    const message = String((raw as { __execError?: unknown }).__execError ?? 'Script failed');
    throw new Error(message);
  }
  return raw;
}

/**
 * The iframe currently hosting the preview guest. Multi-tab previews (MIN-224) create one
 * `iframe.preview-frame` per tab inside `#previewBody` with no id — only the active tab's
 * frame is unhidden. The legacy `#previewFrame` id is kept as a fallback for older mounts
 * and existing tests.
 */
export function getPreviewGuestFrame(designInstanceId?: string): HTMLIFrameElement | null {
  if (designInstanceId === WORKSPACE_PREVIEW_SECONDARY_INSTANCE) {
    const body = document.getElementById('previewBodySecondary');
    const active = body?.querySelector<HTMLIFrameElement>('iframe.preview-frame:not([hidden])');
    if (active) return active;
    return body?.querySelector<HTMLIFrameElement>('iframe.preview-frame') ?? null;
  }
  const body = document.getElementById('previewBody');
  const active = body?.querySelector<HTMLIFrameElement>('iframe.preview-frame:not([hidden])');
  if (active) return active;
  return document.getElementById('previewFrame') as HTMLIFrameElement | null;
}

/** @deprecated Use {@link getPreviewGuestFrame} with an instance id when in split view. */
function getPreviewGuestFrameLegacy(): HTMLIFrameElement | null {
  return getPreviewGuestFrame(WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID);
}

function getPreviewFrame(designInstanceId?: string): HTMLIFrameElement | null {
  return getPreviewGuestFrame(designInstanceId);
}

/** True when the preview page for a design instance is a cross-origin URL. */
export function isCrossOriginPreviewForInstance(instanceId: string): boolean {
  const source = previewSourceForDesignInstance(instanceId);
  if (!source || source.kind !== 'url') return false;
  try {
    const origin = new URL(source.url).origin;
    return origin !== window.location.origin;
  } catch {
    return true;
  }
}

/** @deprecated Use {@link isCrossOriginPreviewForInstance}. */
export function isCrossOriginPreview(): boolean {
  return isCrossOriginPreviewForInstance(WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID);
}

/** Detect Electron execJs vs iframe guest access. */
export function createPickerTransport(
  designInstanceId: string = WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID,
): PickerTransport {
  const preview = window.minnow?.preview;
  // In Electron Design Mode the visible guest is a same-origin iframe and the native
  // WebContentsView is hidden. execJs targets that hidden native view, so it would enable and
  // poll the picker on a guest the user can't click. Read the iframe directly instead.
  if (
    preview &&
    typeof preview.execJs === 'function' &&
    !isDesignModeUsingIframeGuest(designInstanceId)
  ) {
    return {
      mode: 'electron',
      async eval(expression: string): Promise<unknown> {
        const raw = await preview.execJs(expression, undefined, designInstanceId);
        return unwrapExecJsResult(raw);
      },
      canReadGuest(): boolean {
        return true;
      },
    };
  }

  const frame = getPreviewFrame(designInstanceId);
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
    accessibleName: typeof row.accessibleName === 'string' ? row.accessibleName : '',
    contrastRatio:
      typeof row.contrastRatio === 'number' && Number.isFinite(row.contrastRatio)
        ? row.contrastRatio
        : null,
    domPath: typeof row.domPath === 'string' ? row.domPath : '',
    attributes: normalizeStringRecord(row.attributes),
    computedStyles: normalizeStringRecord(row.computedStyles),
  };
}

/** Coerce an unknown value into a `Record<string, string>`, dropping non-string entries. */
function normalizeStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
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
      const stylesDigest = buildStylesDigestForElement(target);
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
          stylesDigest,
          shiftKey: ev.shiftKey,
          accessibleName: computeAccessibleNameForElement(target),
          contrastRatio: computeContrastRatioFromStylesDigest(stylesDigest),
          domPath: buildDomPathForElement(target),
          attributes: attributesForElement(target),
          computedStyles: computedStylesForElement(target),
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

/**
 * CDP-backed picker (MIN-370, Electron only): native `webContents.debugger` hover/click on
 * cross-origin guests, no script injection. Produces the same `PickedElement` shape the
 * execJs/iframe pickers do, so `handlePick` in design-tool.ts doesn't need a CDP-specific branch.
 */
export function createCdpElementPicker(
  options: Omit<ElementPickerOptions, 'transport'>,
): ElementPicker {
  const { onPick, onError } = options;
  let enabled = false;
  let unsubscribePick: (() => void) | null = null;
  let unsubscribeError: (() => void) | null = null;

  return {
    async enable(): Promise<void> {
      if (enabled) return;
      const cdp = window.minnow?.preview?.cdpPicker;
      if (!cdp) {
        onError?.('CDP picking is only available in the Electron app');
        return;
      }
      unsubscribePick = cdp.onPick((picked) => {
        void Promise.resolve(onPick({ ...picked }));
      });
      unsubscribeError = cdp.onError((message) => {
        onError?.(message);
      });
      const result = await cdp.enable();
      if (!result.ok) {
        unsubscribePick?.();
        unsubscribeError?.();
        unsubscribePick = null;
        unsubscribeError = null;
        onError?.(result.error ?? 'failed to enable CDP picking');
        return;
      }
      enabled = true;
    },

    async disable(): Promise<void> {
      if (!enabled) return;
      unsubscribePick?.();
      unsubscribeError?.();
      unsubscribePick = null;
      unsubscribeError = null;
      try {
        await window.minnow?.preview?.cdpPicker.disable();
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

/**
 * True when the CDP picking path should be used instead of execJs/iframe injection: Electron,
 * with a cross-origin preview page where script injection is undesirable/blocked.
 */
export function shouldUseCdpPicker(designInstanceId: string = WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID): boolean {
  return (
    Boolean(window.minnow?.preview?.cdpPicker) &&
    isCrossOriginPreviewForInstance(designInstanceId) &&
    !isDesignModeUsingIframeGuest(designInstanceId)
  );
}

/**
 * Pick the right `ElementPicker` for the current preview: CDP for cross-origin Electron guests,
 * otherwise the existing execJs/iframe picker (same-origin, or the `npm start` fallback).
 */
export function createBestElementPicker(
  options: Omit<ElementPickerOptions, 'transport'> & { designInstanceId?: string },
): ElementPicker {
  const designInstanceId = options.designInstanceId ?? WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID;
  const { designInstanceId: _drop, ...pickerOptions } = options;
  if (shouldUseCdpPicker(designInstanceId)) {
    return createCdpElementPicker(pickerOptions);
  }
  return createElementPicker({
    ...pickerOptions,
    transport: createPickerTransport(designInstanceId),
  });
}
