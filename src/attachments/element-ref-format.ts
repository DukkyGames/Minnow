/**
 * Element-reference label and history serialization (no store dependency).
 */

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
}

function attr(value: string): string {
  return value.replace(/"/g, "'");
}

/** Persisted/API block for a Design Mode element pick (body is the outerHTML preview). */
export function elementRefHistoryBlock(input: ElementRefBlockInput): string {
  const { rect } = input;
  const rectAttr = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
  const uidAttr = input.uid == null ? '' : ` uid="${input.uid}"`;
  const imageAttr = input.imageName ? ` image="${attr(input.imageName)}"` : '';
  return (
    `<element-ref selector="${attr(input.selector)}"${uidAttr} page="${attr(input.pageUrl)}" ` +
    `tag="${attr(input.tagName)}" classes="${attr(input.classList.join(' '))}" rect="${rectAttr}" ` +
    `styles="${attr(input.stylesDigest)}"${imageAttr}>\n${input.outerHtmlPreview}\n</element-ref>`
  );
}
