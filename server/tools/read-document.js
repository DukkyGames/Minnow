/**
 * Extract plain text from PDF and common office attachments (MIN-32).
 * Used by read_document tool and the composer attachment pipeline.
 */

import {
  fileExtension as extensionOf,
  isOfficeExtension,
  OFFICE_EXTENSIONS,
} from '../../src/attachments/document-extensions.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafePath } from '../runtime/path-access.js';
import { wrapUntrusted } from '../security/untrusted.js';
import { capTextOutput } from './output-cap.js';

export { OFFICE_EXTENSIONS, isOfficeExtension };

/** Max decoded bytes (aligns with MAX_ATTACHMENT_BYTES in reader.ts). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** ZIP local-file header (xlsx, xlsm, ods). */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** OLE compound document header (legacy .xls). */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * @param {Buffer} buffer
 * @param {Buffer} magic
 * @returns {boolean}
 */
function bufferStartsWith(buffer, magic) {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

/**
 * Reject corrupt spreadsheet binaries before xlsx parses opaque garbage as text.
 *
 * @param {Buffer} buffer
 * @param {string} filename
 */
function assertSpreadsheetMagic(buffer, filename) {
  const ext = extensionOf(filename);
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'ods') {
    if (!bufferStartsWith(buffer, ZIP_MAGIC)) {
      throw new Error(`file does not look like a valid ${ext} workbook (missing ZIP signature)`);
    }
    return;
  }
  if (ext === 'xls') {
    if (!bufferStartsWith(buffer, OLE_MAGIC)) {
      throw new Error('file does not look like a valid xls workbook (missing OLE signature)');
    }
  }
}

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
  let PDFParse;
  try {
    const mod = await import('pdf-parse');
    PDFParse = mod.PDFParse;
    if (typeof PDFParse !== 'function') {
      throw new Error('PDFParse export missing');
    }
  } catch {
    throw new Error('Internal error: pdf-parse module unavailable');
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const text = String(parsed?.text ?? '').trim();
    const pages = parsed?.total ?? '?';
    return formatDocumentResult(filename, text, `${pages} page(s)`);
  } finally {
    await parser.destroy();
  }
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
    throw new Error('Internal error: xlsx module unavailable');
  }

  assertSpreadsheetMagic(buffer, filename);

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
    throw new Error('Internal error: mammoth module unavailable');
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
    throw new Error('Internal error: officeparser module unavailable');
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
 * @param {string} relPath
 * @param {string} [filenameOverride]
 * @returns {Promise<{ buffer: Buffer, filename: string } | string>}
 */
async function loadDocumentFromPath(relPath, filenameOverride) {
  try {
    const absPath = resolveSafePath(relPath);
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      return `Error: "${relPath}" is not a file`;
    }
    if (stat.size > MAX_DOCUMENT_BYTES) {
      return `Error: document exceeds ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB limit`;
    }
    const buffer = await fs.readFile(absPath);
    const filename =
      typeof filenameOverride === 'string' && filenameOverride.trim()
        ? filenameOverride.trim()
        : path.basename(absPath);
    return { buffer, filename };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) {
      return message;
    }
    return `Error: failed to read "${relPath}": ${message}`;
  }
}

/**
 * @param {string} contentB64
 * @param {string} filename
 * @returns {{ buffer: Buffer, filename: string } | string}
 */
function decodeDocumentContent(contentB64, filename) {
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

  return { buffer, filename };
}

/**
 * @param {string} filename
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isSupportedDocument(filename, buffer) {
  const ext = extensionOf(filename);
  return looksLikePdf(filename, buffer) || ext === 'pdf' || OFFICE_EXTENSIONS.has(ext);
}

/**
 * Cap extracted document text and wrap it as untrusted source data.
 *
 * @param {string} text
 * @param {string} filename
 * @returns {string}
 */
function capAndWrapDocumentText(text, filename) {
  const { text: capped } = capTextOutput(text, {
    footerHint: 'narrow the document scope or read a smaller section',
  });
  return wrapUntrusted(capped, { source: `document:${path.basename(filename)}` });
}

/**
 * Extract workspace document text without the output cap or untrusted wrap.
 * Used by read_file_range so line numbers apply to sheet/PDF text, not ZIP bytes.
 *
 * @param {string} relPath
 * @param {string} [filenameOverride]
 * @returns {Promise<{ filename: string, text: string } | string>}
 */
export async function extractWorkspaceDocumentText(relPath, filenameOverride) {
  const loaded = await loadDocumentFromPath(relPath, filenameOverride);
  if (typeof loaded === 'string') {
    return loaded;
  }

  const { buffer, filename } = loaded;
  if (!isSupportedDocument(filename, buffer)) {
    return (
      `Error: read_document supports PDF and office formats ` +
      `(Excel, Word, PowerPoint, OpenDocument, RTF). Got "${filename}".`
    );
  }

  try {
    const text = await extractDocumentText(buffer, filename);
    return { filename, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) {
      return message;
    }
    return `Error: failed to parse "${filename}": ${message}`;
  }
}

/**
 * read_document tool handler — workspace path or base64 attachment bytes.
 *
 * @param {{ path?: string, filename?: string, content?: string }} args
 * @returns {Promise<string>}
 */
export async function toolReadDocument(args) {
  const relPath = typeof args?.path === 'string' ? args.path.trim() : '';
  const contentB64 = typeof args?.content === 'string' ? args.content : '';
  const filenameArg =
    typeof args?.filename === 'string' && args.filename.trim() ? args.filename.trim() : '';

  if (!relPath && !contentB64) {
    return 'Error: path (workspace-relative) or content (base64 file bytes) is required';
  }

  if (relPath) {
    const extracted = await extractWorkspaceDocumentText(relPath, filenameArg || undefined);
    if (typeof extracted === 'string') {
      return extracted;
    }
    return capAndWrapDocumentText(extracted.text, extracted.filename);
  }

  const filename = filenameArg || 'document.bin';
  const loaded = decodeDocumentContent(contentB64, filename);
  if (typeof loaded === 'string') {
    return loaded;
  }

  if (!isSupportedDocument(loaded.filename, loaded.buffer)) {
    return (
      `Error: read_document supports PDF and office formats ` +
      `(Excel, Word, PowerPoint, OpenDocument, RTF). Got "${loaded.filename}".`
    );
  }

  try {
    const text = await extractDocumentText(loaded.buffer, loaded.filename);
    return capAndWrapDocumentText(text, loaded.filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) {
      return message;
    }
    return `Error: failed to parse "${loaded.filename}": ${message}`;
  }
}
