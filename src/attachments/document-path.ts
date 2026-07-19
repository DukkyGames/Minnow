/**
 * Workspace document path helpers (PDF, Excel, Word) for preview routing.
 */

import {
  getDocumentPreviewKind as getKind,
  isPdfFilePath as isPdfPath,
  isSpreadsheetFilePath as isSpreadsheetPath,
  isWordFilePath as isWordPath,
} from './document-extensions.mjs';

export type DocumentPreviewKind = 'pdf' | 'spreadsheet' | 'word';

export const isPdfFilePath = isPdfPath;
export const isSpreadsheetFilePath = isSpreadsheetPath;
export const isWordFilePath = isWordPath;

/** Preview kind for supported office/PDF paths, or null when unsupported. */
export function getDocumentPreviewKind(path: string): DocumentPreviewKind | null {
  return getKind(path);
}

/** Map preview kind to a viewer viewMode value. */
export function documentPreviewViewMode(kind: DocumentPreviewKind): 'pdf' | 'spreadsheet' | 'word' {
  return kind;
}
