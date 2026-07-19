/**
 * Design Mode element picks → composer element-reference chips (MIN-366).
 */

import { formatElementRefLabel } from './element-ref-format';
export { elementRefHistoryBlock, formatElementRefLabel } from './element-ref-format';
import { getActiveComposerSurface } from '../ui/composer-surface';
import { pushAttachment, getPendingAttachments } from './store';
import type { Attachment } from './types';

function newElementRefId(): string {
  return `eref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Picker payload accepted by {@link addElementRefToComposer}. */
export interface ElementRefInput {
  selector: string;
  uid: number | null;
  pageUrl: string;
  tagName: string;
  classList: string[];
  outerHtmlPreview: string;
  rect: { x: number; y: number; width: number; height: number };
  stylesDigest: string;
  /** DPR-correct cropped screenshot data URL, when region-capture succeeded. */
  croppedDataUrl?: string;
  /** A11y quick-pass (MIN-370): aria-label || alt || trimmed text content. */
  accessibleName?: string;
  /** A11y quick-pass (MIN-370): WCAG contrast ratio of color vs background, or null when unknown. */
  contrastRatio?: number | null;
  /** Readable ancestor chain, e.g. `div#root > main.page > button.cta`. */
  domPath?: string;
  /** Every attribute on the picked element (name → value). */
  attributes?: Record<string, string>;
  /** Curated computed styles (camelCase key → value). */
  computedStyles?: Record<string, string>;
}

/**
 * Queue a Design Mode element pick as a composer chip; dedupes by page + uid
 * (falls back to page + selector when the element has no `data-mn-uid`).
 * Returns the pushed (or existing, on dedupe) attachment.
 */
export function addElementRefToComposer(input: ElementRefInput): Attachment | null {
  const page = input.pageUrl.trim();
  const selector = input.selector.trim();
  if (!selector) return null;

  const uid = input.uid;
  const duplicate = getPendingAttachments().find(
    (item) =>
      item.kind === 'elementRef' &&
      item.pageUrl === page &&
      (uid != null ? item.uid === uid : item.selector === selector),
  );
  if (duplicate) {
    focusComposerInput();
    return duplicate;
  }

  const attachment: Attachment = {
    id: newElementRefId(),
    name: formatElementRefLabel(selector, page),
    kind: 'elementRef',
    mimeType: 'text/html',
    size: input.outerHtmlPreview.length,
    selector,
    uid: uid ?? undefined,
    pageUrl: page,
    tagName: input.tagName,
    classList: [...input.classList],
    outerHtmlPreview: input.outerHtmlPreview,
    rect: { ...input.rect },
    stylesDigest: input.stylesDigest,
    croppedDataUrl: input.croppedDataUrl,
    accessibleName: input.accessibleName,
    contrastRatio: input.contrastRatio ?? null,
    domPath: input.domPath,
    attributes: input.attributes ? { ...input.attributes } : undefined,
    computedStyles: input.computedStyles ? { ...input.computedStyles } : undefined,
  };

  pushAttachment(attachment);
  focusComposerInput();
  return attachment;
}

/** Focus the foreground composer (Code / Chat / desktop), not a hardcoded #msgInput. */
function focusComposerInput(): void {
  getActiveComposerSurface().inputEl?.focus();
}

/** True when attachment is a queued Design Mode element reference. */
export function isElementRefAttachment(
  attachment: Attachment,
): attachment is Attachment & {
  kind: 'elementRef';
  selector: string;
  pageUrl: string;
  tagName: string;
  classList: string[];
  rect: { x: number; y: number; width: number; height: number };
  stylesDigest: string;
  outerHtmlPreview: string;
} {
  return (
    attachment.kind === 'elementRef' &&
    Boolean(attachment.selector) &&
    typeof attachment.pageUrl === 'string' &&
    Boolean(attachment.tagName) &&
    Array.isArray(attachment.classList) &&
    Boolean(attachment.rect) &&
    typeof attachment.stylesDigest === 'string' &&
    typeof attachment.outerHtmlPreview === 'string'
  );
}
