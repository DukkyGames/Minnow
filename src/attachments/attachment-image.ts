/**
 * One accessor for the pixels a composer attachment carries.
 *
 * Three attachment kinds hold image bytes under three different field names —
 * a dropped/pasted file (`dataUrl`), a Design Mode element pick (`croppedDataUrl`),
 * and a design annotation (`compositedDataUrl`). Every send, estimate, and render
 * path reads them through here so none can quietly handle only two of the three.
 */

import type { Attachment } from './types';

/** Image data URL for this attachment, or undefined when it carries no pixels. */
export function attachmentImageDataUrl(att: Attachment): string | undefined {
  if (att.kind === 'image') return att.dataUrl;
  if (att.kind === 'elementRef') return att.croppedDataUrl;
  if (att.kind === 'designRef') return att.compositedDataUrl;
  return undefined;
}

/** True when any of these attachments carries image bytes. */
export function attachmentsHaveImages(attachments: Attachment[]): boolean {
  return attachments.some((att) => Boolean(attachmentImageDataUrl(att)));
}
