/**
 * Element-reference label and history serialization (no store dependency).
 */

import type { SourceMapping } from '../design/source-map';

function basename(path: string): string {
  const withoutProtocol = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const normalized = withoutProtocol.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** Last selector segment, e.g. `body > div.hero > button.cta` → `button.cta`. */
function shortSelector(selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return 'element';
  const segments = trimmed.split('>').map((part) => part.trim());
  return segments[segments.length - 1] || trimmed;
}

/** Label for composer chips and chat links: `button.cta — pricing.html`. */
export function formatElementRefLabel(selector: string, pageUrl: string): string {
  const page = basename(pageUrl.trim());
  const short = shortSelector(selector);
  return page ? `${short} — ${page}` : short;
}

/** Fields serialized into an `<element-ref>` history/API block. */
export interface ElementRefBlockInput {
  selector: string;
  uid: number | null;
  pageUrl: string;
  tagName: string;
  classList: string[];
  rect: { x: number; y: number; width: number; height: number };
  stylesDigest: string;
  outerHtmlPreview: string;
  /** Name of the co-emitted `[image: name]` placeholder, when a crop was captured. */
  imageName?: string;
  /** Resolved file:line (or guess) for the picked element, when async resolution has landed (MIN-369). */
  sourceMapping?: SourceMapping;
  /** A11y quick-pass (MIN-370): aria-label || alt || trimmed text content. */
  accessibleName?: string;
  /** A11y quick-pass (MIN-370): WCAG contrast ratio of color vs background, or null when unknown. */
  contrastRatio?: number | null;
}

function attr(value: string): string {
  return value.replace(/"/g, "'");
}

/**
 * `source="file:line"` (or component name when there's no line) plus `confidence="…"` — only
 * emitted once resolution has landed; omitted entirely while a pick's mapping is still pending
 * or resolution never ran (never blocks/delays the block from being sent).
 */
function sourceMapAttrs(mapping: SourceMapping | undefined): string {
  if (!mapping) return '';
  const location = mapping.file
    ? `${mapping.file}${mapping.line != null ? `:${mapping.line}` : ''}`
    : (mapping.component ?? '');
  const sourceAttr = location ? ` source="${attr(location)}"` : '';
  return `${sourceAttr} confidence="${mapping.confidence}"`;
}

/**
 * A11y quick-pass (MIN-370): `name="…"` (accessible name, when non-empty) and
 * `contrast="…"` (WCAG ratio, when computable) — omitted entirely when there's nothing useful to
 * report, same "never blocks/never required" contract as {@link sourceMapAttrs}.
 */
function a11yAttrs(accessibleName: string | undefined, contrastRatio: number | null | undefined): string {
  const nameAttr = accessibleName?.trim() ? ` name="${attr(accessibleName.trim())}"` : '';
  const contrastAttr =
    typeof contrastRatio === 'number' && Number.isFinite(contrastRatio) ? ` contrast="${contrastRatio}"` : '';
  return `${nameAttr}${contrastAttr}`;
}

/** Persisted/API block for a Design Mode element pick (body is the outerHTML preview). */
export function elementRefHistoryBlock(input: ElementRefBlockInput): string {
  const { rect } = input;
  const rectAttr = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
  const uidAttr = input.uid == null ? '' : ` uid="${input.uid}"`;
  const imageAttr = input.imageName ? ` image="${attr(input.imageName)}"` : '';
  const sourceAttrs = sourceMapAttrs(input.sourceMapping);
  const a11y = a11yAttrs(input.accessibleName, input.contrastRatio);
  return (
    `<element-ref selector="${attr(input.selector)}"${uidAttr} page="${attr(input.pageUrl)}" ` +
    `tag="${attr(input.tagName)}" classes="${attr(input.classList.join(' '))}" rect="${rectAttr}" ` +
    `styles="${attr(input.stylesDigest)}"${sourceAttrs}${a11y}${imageAttr}>\n${input.outerHtmlPreview}\n</element-ref>`
  );
}
