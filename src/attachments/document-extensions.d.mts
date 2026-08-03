export const OFFICE_EXTENSIONS: ReadonlySet<string>;
export function fileExtension(name: string): string;
export function isOfficeExtension(filename: string): boolean;
export function isPdfFilePath(pathOrName: string): boolean;
export function isSpreadsheetFilePath(pathOrName: string): boolean;
export function isWordFilePath(pathOrName: string): boolean;
export function getDocumentPreviewKind(
  pathOrName: string,
): 'pdf' | 'spreadsheet' | 'word' | null;
