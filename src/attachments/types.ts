/**
 * Attachment shapes for the composer preview and API payload builders (SA-13).
 */

/** How an attachment is represented after `processFile` or workspace drag-drop. */
export type AttachmentKind =
  | 'image'
  | 'text'
  | 'pdf'
  | 'error'
  | 'workspace'
  | 'codeRef'
  | 'elementRef';

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
  /** Project-relative path for workspace reference chips (loaded on send). */
  workspacePath?: string;
  /** 1-based start line for `codeRef` selections. */
  lineStart?: number;
  /** 1-based end line for `codeRef` selections (inclusive). */
  lineEnd?: number;
  /** CSS selector for a Design Mode element pick (`elementRef`). */
  selector?: string;
  /** `data-mn-uid` stamped on the picked element (`elementRef`). */
  uid?: number;
  /** Page the element was picked from: workspace path or preview URL (`elementRef`). */
  pageUrl?: string;
  /** Lowercase tag name of the picked element (`elementRef`). */
  tagName?: string;
  /** Class list of the picked element (`elementRef`). */
  classList?: string[];
  /** Capped outerHTML preview of the picked element (`elementRef`). */
  outerHtmlPreview?: string;
  /** Bounding rect (CSS px, guest coordinates) of the picked element at capture time (`elementRef`). */
  rect?: { x: number; y: number; width: number; height: number };
  /** Condensed computed-styles digest: typography/color/spacing/layout mode (`elementRef`). */
  stylesDigest?: string;
  /** DPR-correct cropped screenshot data URL of the picked element (`elementRef`). */
  croppedDataUrl?: string;
}
