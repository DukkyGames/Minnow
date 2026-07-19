/**
 * Render workspace PDF/Excel/Word files as HTML for the file viewer preview pane.
 */

import { fileExtension as extensionOf } from '../../src/attachments/document-extensions.mjs';
import { getDocumentPreviewKind } from '../../src/attachments/document-extensions.mjs';

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PREVIEW_STYLES = `
body {
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
  margin: 0;
  padding: 16px 20px 28px;
  color: #1a1a1a;
  background: #fff;
  line-height: 1.5;
}
h1, h2, h3 { margin: 0 0 12px; }
table { border-collapse: collapse; margin: 0 0 24px; width: max-content; max-width: 100%; }
th, td { border: 1px solid #c8c8c8; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f3f3f3; font-weight: 600; }
.sheet-title { margin-top: 24px; }
.sheet-title:first-child { margin-top: 0; }
.muted { color: #666; font-size: 13px; }
`;

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function spreadsheetBufferToHtml(buffer, filename) {
  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    throw new Error(
      'Spreadsheet preview requires the optional "xlsx" package. Install with: npm install xlsx',
    );
  }

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parts = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(filename)}</title>`,
    `<style>${PREVIEW_STYLES}</style></head><body>`,
    `<p class="muted">${escapeHtml(filename)} · ${workbook.SheetNames.length} sheet(s)</p>`,
  ];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const tableHtml = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${sheetName}` });
    parts.push(`<h2 class="sheet-title">${escapeHtml(sheetName)}</h2>${tableHtml}`);
  }

  parts.push('</body></html>');
  return parts.join('');
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function wordBufferToHtml(buffer, filename) {
  const ext = extensionOf(filename);
  if (ext === 'docx') {
    let mammoth;
    try {
      const mod = await import('mammoth');
      mammoth = mod.default ?? mod;
    } catch {
      throw new Error(
        'Word preview requires the optional "mammoth" package. Install with: npm install mammoth',
      );
    }

    const result = await mammoth.convertToHtml({ buffer });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      filename,
    )}</title><style>${PREVIEW_STYLES}</style></head><body><p class="muted">${escapeHtml(
      filename,
    )}</p>${result.value}</body></html>`;
  }

  let parseOffice;
  try {
    const mod = await import('officeparser');
    parseOffice =
      mod.parseOffice ??
      mod.OfficeParser?.parseOffice ??
      mod.default?.parseOffice ??
      mod.default;
  } catch {
    throw new Error(
      'Legacy Word preview requires the optional "officeparser" package. Install with: npm install officeparser',
    );
  }

  if (typeof parseOffice !== 'function') {
    throw new Error('officeparser did not export parseOffice');
  }

  const ast = await parseOffice(buffer);
  const text =
    typeof ast?.toText === 'function'
      ? ast.toText()
      : String(ast?.content ?? ast ?? '');
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
    filename,
  )}</title><style>${PREVIEW_STYLES}</style></head><body><p class="muted">${escapeHtml(
    filename,
  )}</p><div>${body}</div></body></html>`;
}

/**
 * Build HTML preview for a workspace document file.
 *
 * @param {string} absPath
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function renderDocumentPreviewHtml(absPath, buffer) {
  const filename = absPath.split(/[/\\]/).pop() ?? 'document';
  const kind = getDocumentPreviewKind(filename);
  if (kind === 'spreadsheet') {
    return spreadsheetBufferToHtml(buffer, filename);
  }
  if (kind === 'word') {
    return wordBufferToHtml(buffer, filename);
  }
  throw new Error(`No HTML preview available for "${filename}"`);
}

/**
 * True when the relative path can be rendered through the document-html preview route.
 *
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isDocumentHtmlPreviewPath(relativePath) {
  const kind = getDocumentPreviewKind(relativePath);
  return kind === 'spreadsheet' || kind === 'word';
}
