/**
 * Design Mode drawn shapes → composer design-reference chips (MIN-367). Mirrors element-ref.ts;
 * unlike elementRef picks, each finished shape is always its own attachment (no dedupe — a
 * second arrow drawn near the first is a distinct annotation, not a re-pick).
 */

import { designRefHistoryBlock, formatDesignRefLabel, structuredIntentForShape } from './design-ref-format';
export { designRefHistoryBlock, formatDesignRefLabel, structuredIntentForShape } from './design-ref-format';
import { getActiveComposerSurface } from '../ui/composer-surface';
import { pushAttachment } from './store';
import type { Attachment } from './types';
import type { DesignShape } from '../design/shape-model';

function newDesignRefId(): string {
  return `dref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Finished shape payload accepted by {@link addDesignRefToComposer}. */
export interface DesignRefInput {
  shape: DesignShape;
  pageUrl: string;
  /** Composited crop (region + rasterized overlay) data URL, when region-capture succeeded. */
  compositedDataUrl?: string;
}

/** Queue a Design Mode drawn shape as a composer chip. Returns the pushed attachment. */
export function addDesignRefToComposer(input: DesignRefInput): Attachment | null {
  const page = input.pageUrl.trim();
  const intentText = structuredIntentForShape(input.shape);

  const attachment: Attachment = {
    id: newDesignRefId(),
    name: formatDesignRefLabel(input.shape.kind, page),
    kind: 'designRef',
    mimeType: 'text/plain',
    size: intentText.length,
    shape: input.shape,
    pageUrl: page,
    compositedDataUrl: input.compositedDataUrl,
    intentText,
  };

  pushAttachment(attachment);
  focusComposerInput();
  return attachment;
}

/** Focus the foreground composer (Code / Chat / desktop), not a hardcoded #msgInput. */
function focusComposerInput(): void {
  getActiveComposerSurface().inputEl?.focus();
}

/** True when attachment is a queued Design Mode drawn shape. */
export function isDesignRefAttachment(
  attachment: Attachment,
): attachment is Attachment & {
  kind: 'designRef';
  shape: DesignShape;
  pageUrl: string;
  intentText: string;
} {
  return (
    attachment.kind === 'designRef' &&
    Boolean(attachment.shape) &&
    typeof attachment.pageUrl === 'string' &&
    typeof attachment.intentText === 'string'
  );
}
