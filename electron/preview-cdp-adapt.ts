/**
 * CDP DOM/CSS payload → design-picker pick, adapted (MIN-370 P7).
 * Pure — no `electron` import — so this is the testable core of the CDP cross-origin
 * picking path: `test/electron/preview-cdp-adapt.test.mjs` exercises it with mocked CDP
 * responses, no live debugger session required.
 *
 * The output shape is structurally identical to `PickedElement` in
 * `src/design/element-picker.ts` (duplicated here rather than imported: electron/tsconfig.json
 * only compiles top-level `electron/*.ts`, it does not reach into `src/`).
 */

export interface CdpPickedElement {
  uid: number | null;
  cssSelector: string;
  tagName: string;
  classList: string[];
  outerHTMLPreview: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  stylesDigest: string;
  shiftKey: boolean;
  accessibleName: string;
  contrastRatio: number | null;
}

/** `DOM.getBoxModel` result content quad: [x1,y1,x2,y2,x3,y3,x4,y4] (clockwise from top-left). */
export interface CdpBoxModelContent {
  content: number[];
}

/** One `CSS.getComputedStyleForNode` entry. */
export interface CdpComputedStyleProperty {
  name: string;
  value: string;
}

/** Raw payload assembled by the main-process CDP orchestrator (preview-cdp-pick.ts) per pick. */
export interface CdpRawPick {
  /** `DOM.describeNode`'s flat attribute array: [name1, value1, name2, value2, ...]. */
  attributes?: string[];
  nodeName: string;
  localName?: string;
  boxModel: CdpBoxModelContent;
  outerHTML: string;
  computedStyle: CdpComputedStyleProperty[];
  devicePixelRatio: number;
  shiftKey: boolean;
}

function parseCdpAttributes(flat: string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(flat)) return map;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    map.set(flat[i], flat[i + 1]);
  }
  return map;
}

function escapeCssIdentSafe(value: string): string {
  return value.replace(/([.#:[\]\s])/g, '\\$1');
}

/**
 * Best-effort selector from CDP attributes alone (no live `DOM.querySelectorAll` uniqueness
 * check — the orchestrator can add one via an extra round-trip if stricter guarantees are
 * needed later). Prefers `id`, falls back to `tag.class1.class2`, then bare tag.
 */
function buildCdpSelector(tag: string, attrs: Map<string, string>): string {
  const id = (attrs.get('id') || '').trim();
  if (id) return `#${escapeCssIdentSafe(id)}`;
  const classAttr = (attrs.get('class') || '').trim();
  const classes = classAttr
    .split(/\s+/)
    .filter(Boolean)
    .filter((name) => !/^(css-|sc-|_)/.test(name) && !/[0-9a-f]{6,}/i.test(name))
    .slice(0, 2);
  if (classes.length) {
    return `${tag}${classes.map((c) => `.${escapeCssIdentSafe(c)}`).join('')}`;
  }
  return tag;
}

/** Convert an 8-number CDP content quad into an axis-aligned bounding rect. */
function quadToBoundingRect(content: number[]): { x: number; y: number; width: number; height: number } {
  if (!Array.isArray(content) || content.length < 8) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const xs = [content[0], content[2], content[4], content[6]];
  const ys = [content[1], content[3], content[5], content[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function computedStyleValue(style: CdpComputedStyleProperty[], name: string): string {
  return style.find((entry) => entry.name === name)?.value ?? '';
}

/** Mirrors element-picker.ts's in-guest `stylesDigestFor` using CDP computed-style entries. */
function buildStylesDigestFromComputedStyle(style: CdpComputedStyleProperty[]): string {
  const fontSize = computedStyleValue(style, 'font-size');
  const lineHeight = computedStyleValue(style, 'line-height');
  const fontFamily = (computedStyleValue(style, 'font-family').split(',')[0] || '').replace(/["']/g, '').trim();
  const fontWeight = computedStyleValue(style, 'font-weight');
  const color = computedStyleValue(style, 'color');
  const backgroundColor = computedStyleValue(style, 'background-color');
  const padding = computedStyleValue(style, 'padding');
  const margin = computedStyleValue(style, 'margin');
  const gap = computedStyleValue(style, 'gap');
  const display = computedStyleValue(style, 'display');
  const position = computedStyleValue(style, 'position');

  const font = `${fontSize}/${lineHeight} ${fontFamily} ${fontWeight}`;
  let spacing = `p:${padding} m:${margin}`;
  if (gap && gap !== 'normal') spacing += ` gap:${gap}`;
  const layout = `${display}${position && position !== 'static' ? ` ${position}` : ''}`;

  return `font:${font}; color:${color}; bg:${backgroundColor}; ${spacing}; layout:${layout}`.slice(0, 300);
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseCssColor(value: string): RgbaColor | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'transparent') return null;
  const match = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function linearChannel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: RgbaColor): number {
  return 0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b);
}

/** WCAG contrast ratio of foreground vs background; null when either color can't be parsed. */
export function contrastRatioOfCdp(fg: RgbaColor, bg: RgbaColor): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

function contrastRatioFromComputedStyle(style: CdpComputedStyleProperty[]): number | null {
  const fg = parseCssColor(computedStyleValue(style, 'color'));
  const bg = parseCssColor(computedStyleValue(style, 'background-color'));
  if (!fg || !bg || bg.a === 0) return null;
  return contrastRatioOfCdp(fg, bg);
}

function accessibleNameFromAttrs(attrs: Map<string, string>, outerHTML: string): string {
  const ariaLabel = (attrs.get('aria-label') || '').trim();
  if (ariaLabel) return ariaLabel.slice(0, 160);
  const alt = (attrs.get('alt') || '').trim();
  if (alt) return alt.slice(0, 160);
  // Best-effort text fallback: strip tags from the outerHTML preview (no live textContent access
  // without an extra CDP round-trip). Good enough for the "guess" tier.
  const stripped = outerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.slice(0, 160);
}

/**
 * Pure adapter: CDP `DOM.describeNode` + `DOM.getBoxModel` + `CSS.getComputedStyleForNode` +
 * `DOM.getOuterHTML` results → the same `PickedElement`-shaped payload the injected-script and
 * iframe pickers produce, so downstream consumers (region-capture, elementRef chips, source
 * mapping) don't need a CDP-specific branch.
 */
export function adaptCdpRawPick(raw: CdpRawPick, uid: number | null): CdpPickedElement {
  const tagName = (raw.localName || raw.nodeName || 'element').toLowerCase();
  const attrs = parseCdpAttributes(raw.attributes);
  const classList = (attrs.get('class') || '').trim().split(/\s+/).filter(Boolean);
  const stylesDigest = buildStylesDigestFromComputedStyle(raw.computedStyle);

  return {
    uid,
    cssSelector: buildCdpSelector(tagName, attrs),
    tagName,
    classList,
    outerHTMLPreview: (raw.outerHTML || '').slice(0, 200).replace(/\s+/g, ' '),
    boundingRect: quadToBoundingRect(raw.boxModel.content),
    devicePixelRatio: Number.isFinite(raw.devicePixelRatio) && raw.devicePixelRatio > 0 ? raw.devicePixelRatio : 1,
    stylesDigest,
    shiftKey: Boolean(raw.shiftKey),
    accessibleName: accessibleNameFromAttrs(attrs, raw.outerHTML || ''),
    contrastRatio: contrastRatioFromComputedStyle(raw.computedStyle),
  };
}
