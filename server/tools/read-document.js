/**
 * Extract plain text from PDF and common office attachments (MIN-32).
 * Used by read_document tool and the composer attachment pipeline.
 */

import {
  fileExtension as extensionOf,
  isOfficeExtension,
  OFFICE_EXTENSIONS,
} from '../../src/attachments/document-extensions.mjs';
import path from 'node:path';
import { wrapUntrusted } from '../security/untrusted.js';

export { OFFICE_EXTENSIONS, isOfficeExtension };

/** Max decoded bytes (aligns with MAX_ATTACHMENT_BYTES in reader.ts). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * @param {string} filename
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function looksLikePdf(filename, buffer) {
  return (
    filename.toLowerCase().endsWith('.pdf') ||
    buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  );
}

/**
 * @param {string} filename
 * @returns {'pdf' | 'spreadsheet' | 'word' | 'presentation' | 'office' | 'unknown'}
 */
function documentKind(filename) {
  const ext = extensionOf(filename);
  if (ext === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'xlsm', 'ods', 'csv'].includes(ext)) return 'spreadsheet';
  if (['docx', 'doc', 'odt', 'rtf'].includes(ext)) return 'word';
  if (['pptx', 'ppt', 'odp'].includes(ext)) return 'presentation';
  if (OFFICE_EXTENSIONS.has(ext)) return 'office';
  return 'unknown';
}

/**
 * @param {string} filename
 * @param {string} body
 * @param {string} [meta]
 * @returns {string}
 */
function formatDocumentResult(filename, body, meta) {
  const trimmed = String(body ?? '').trim();
  const suffix = meta ? ` (${meta})` : '';
  if (!trimmed) {
    return `Document "${filename}" parsed but contained no extractable text${suffix}.`;
  }
  return `--- ${filename}${suffix} ---\n${trimmed}`;
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function extractPdf(buffer, filename) {
  let pdfParse;
  try {
    const mod = await import('pdf-parse');
    pdfParse = mod.default ?? mod;
  } catch {
    throw new Error(
      'PDF text extraction requires the optional "pdf-parse" package. ' +
        'Install with: npm install pdf-parse',
    );
  }

  const parsed = await pdfParse(buffer);
  const text = String(parsed?.text ?? '').trim();
  const pages = parsed?.numpages ?? '?';
  return formatDocumentResult(filename, text, `${pages} page(s)`);
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function extractSpreadsheet(buffer, filename) {
  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    throw new Error(
      'Spreadsheet extraction requires the optional "xlsx" package. ' +
        'Install with: npm install xlsx',
    );
  }

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const trimmed = String(csv ?? '').trim();
    if (trimmed) {
      parts.push(`## Sheet: ${sheetName}\n${trimmed}`);
    }
  }

  const meta = `${workbook.SheetNames.length} sheet(s)`;
  return formatDocumentResult(filename, parts.join('\n\n'), meta);
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function extractDocx(buffer, filename) {
  let mammoth;
  try {
    const mod = await import('mammoth');
    mammoth = mod.default ?? mod;
  } catch {
    throw new Error(
      'Word document extraction requires the optional "mammoth" package. ' +
        'Install with: npm install mammoth',
    );
  }

  const result = await mammoth.extractRawText({ buffer });
  const warnings =
    Array.isArray(result.messages) && result.messages.length > 0
      ? `${result.messages.length} conversion note(s)`
      : undefined;
  return formatDocumentResult(filename, result.value, warnings);
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function extractOfficeParser(buffer, filename) {
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
      'Presentation and legacy Office formats require the optional "officeparser" package. ' +
        'Install with: npm install officeparser',
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
  return formatDocumentResult(filename, String(text ?? ''));
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<string>}
 */
export async function extractDocumentText(buffer, filename) {
  const safeName =
    typeof filename === 'string' && filename.trim() ? filename.trim() : 'document';

  if (looksLikePdf(safeName, buffer)) {
    return extractPdf(buffer, safeName);
  }

  const kind = documentKind(safeName);

  if (kind === 'spreadsheet') {
    return extractSpreadsheet(buffer, safeName);
  }

  if (kind === 'word' && extensionOf(safeName) === 'docx') {
    return extractDocx(buffer, safeName);
  }

  if (
    kind === 'presentation' ||
    kind === 'office' ||
    (kind === 'word' && extensionOf(safeName) !== 'docx')
  ) {
    return extractOfficeParser(buffer, safeName);
  }

  throw new Error(
    `Unsupported document type for "${safeName}". Supported: PDF, Excel (.xlsx, .xls), Word (.docx), PowerPoint (.pptx), OpenDocument, RTF.`,
  );
}

/**
 * read_document tool handler body (after base64 decode and size checks).
 *
 * @param {{ filename?: string, content?: string }} args
 * @returns {Promise<string>}
 */
export async function toolReadDocument(args) {
  const contentB64 = args?.content;
  if (!contentB64 || typeof contentB64 !== 'string') {
    return 'Error: content (base64 file bytes) is required';
  }

  const filename =
    typeof args?.filename === 'string' && args.filename.trim()
      ? args.filename.trim()
      : 'document.bin';

  let buffer;
  try {
    buffer = Buffer.from(contentB64, 'base64');
  } catch {
    return 'Error: content is not valid base64';
  }

  if (buffer.length === 0) {
    return 'Error: empty document';
  }

  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return `Error: document exceeds ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB limit`;
  }

  const ext = extensionOf(filename);
  const supported =
    looksLikePdf(filename, buffer) ||
    ext === 'pdf' ||
    OFFICE_EXTENSIONS.has(ext);

  if (!supported) {
    return (
      `Error: read_document supports PDF and office formats ` +
      `(Excel, Word, PowerPoint, OpenDocument, RTF). Got "${filename}".`
    );
  }

  try {
    const text = await extractDocumentText(buffer, filename);
    return wrapUntrusted(text, { source: `document:${path.basename(filename)}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) {
      return message;
    }
    return `Error: failed to parse "${filename}": ${message}`;
  }
}
