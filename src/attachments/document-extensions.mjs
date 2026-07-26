/**
 * Office document extensions for read_document (MIN-32).
 * Shared by browser reader and server extractors — keep lists in sync.
 */

/** @type {ReadonlySet<string>} */
export const OFFICE_EXTENSIONS = new Set([
  'xlsx',
  'xls',
  'xlsm',
  'ods',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'odt',
  'odp',
  'rtf',
]);

/** @param {string} name */
export function fileExtension(name) {
  const base = String(name).split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** @param {string} filename */
export function isOfficeExtension(filename) {
  return OFFICE_EXTENSIONS.has(fileExtension(filename));
}

const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'ods']);
const WORD_EXTENSIONS = new Set(['docx', 'doc', 'odt', 'rtf']);

/** @param {string} pathOrName */
export function isPdfFilePath(pathOrName) {
  return fileExtension(pathOrName) === 'pdf';
}

/** @param {string} pathOrName */
export function isSpreadsheetFilePath(pathOrName) {
  return SPREADSHEET_EXTENSIONS.has(fileExtension(pathOrName));
}

/** @param {string} pathOrName */
export function isWordFilePath(pathOrName) {
  return WORD_EXTENSIONS.has(fileExtension(pathOrName));
}

/**
 * @param {string} pathOrName
 * @returns {'pdf' | 'spreadsheet' | 'word' | null}
 */
export function getDocumentPreviewKind(pathOrName) {
  if (isPdfFilePath(pathOrName)) return 'pdf';
  if (isSpreadsheetFilePath(pathOrName)) return 'spreadsheet';
  if (isWordFilePath(pathOrName)) return 'word';
  return null;
}
