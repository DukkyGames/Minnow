/**
 * Attachment shapes for the composer preview and API payload builders (SA-13).
 */

/** How an attachment is represented after `processFile`. */
export type AttachmentKind = 'image' | 'text' | 'pdf' | 'error';

/** One pending file in the composer strip before send. */
export interface Attachment {
  /** Stable id for remove buttons and deduplication. */
  id: string;
  /** Original file name from the picker. */
  name: string;
  kind: AttachmentKind;
  /** Browser-reported MIME type (may be empty for some extensions). */
  mimeType: string;
  /** Raw file size in bytes. */
  size: number;
  /** Data URL for vision models (`image/*` only). */
  dataUrl?: string;
  /** Plain text for code/text files or extracted PDF text. */
  text?: string;
  /** User-visible error when kind is `error`. */
  error?: string;
  /** True when text content exceeds the soft 32KB warning threshold. */
  largeTextWarning?: boolean;
}
