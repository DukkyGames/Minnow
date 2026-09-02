/**
 * Design-reference (drawn shape) label and history serialization (MIN-367).
 * Sibling of element-ref-format.ts — no store dependency.
 */

import { structuredIntentForShape, type DesignShape } from '../design/shape-model';

export { structuredIntentForShape };

function basename(path: string): string {
  const withoutProtocol = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const normalized = withoutProtocol.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** Label for composer chips and chat links: `arrow — pricing.html`. */
export function formatDesignRefLabel(kind: string, pageUrl: string): string {
  const page = basename(pageUrl.trim());
  const label = kind === 'pen' ? 'sketch' : kind;
  return page ? `${label} — ${page}` : label;
}

/** Fields serialized into a `<design-ref>` history/API block. */
export interface DesignRefBlockInput {
  shape: DesignShape;
  pageUrl: string;
  intentText: string;
  /** Name of the co-emitted `[image: name]` placeholder, when a composited crop was captured. */
  imageName?: string;
}

function attr(value: string): string {
  return value.replace(/"/g, "'");
}

/** Persisted/API block for a Design Mode drawn shape (body is the structured intent text). */
export function designRefHistoryBlock(input: DesignRefBlockInput): string {
  const { shape } = input;
  const anchorAttr =
    shape.anchor.type === 'element'
      ? ` anchor="element" anchorSelector="${attr(shape.anchor.selector)}"` +
        (shape.anchor.uid != null ? ` anchorUid="${shape.anchor.uid}"` : '')
      : ` anchor="page" anchorX="${Math.round(shape.anchor.x)}" anchorY="${Math.round(shape.anchor.y)}"`;
  const imageAttr = input.imageName ? ` image="${attr(input.imageName)}"` : '';
  const idAttr = ` id="${attr(shape.id)}"`;
  return (
    `<design-ref kind="${attr(shape.kind)}" page="${attr(input.pageUrl)}"${anchorAttr}${imageAttr}${idAttr}>\n` +
    `${input.intentText}\n</design-ref>`
  );
}
