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
