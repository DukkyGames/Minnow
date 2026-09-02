/**
 * Built-in tools to create PDF, Excel (.xlsx), and Word (.docx) files in the workspace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExtension as extensionOf } from '../../src/attachments/document-extensions.mjs';
import { getEffectiveWorkspaceRoot, resolveSafePath } from '../runtime/path-access.js';
import {
  drawVisualLine,
  embedLayoutFonts,
  formatReplacedCharacters,
  layoutBodyText,
  preloadPdfFonts,
} from './pdf-layout.js';

/** Max decoded document body size for PDF text (chars). */
const MAX_PDF_BODY_CHARS = 200_000;

/** Max rows per sheet when creating spreadsheets. */
const MAX_SHEET_ROWS = 10_000;

/** Max sections when creating Word documents. */
const MAX_WORD_SECTIONS = 500;

/**
 * @param {string} absPath
 * @returns {string}
 */
function toRelativePath(absPath) {
  const rel = path.relative(getEffectiveWorkspaceRoot(), absPath);
  return rel === '' ? '.' : rel.replace(/\\/g, '/');
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {{ title?: string, body?: string }} input
 * @returns {Promise<{ buffer: Buffer, replaced: string[] }>}
 */
async function buildPdfBuffer(input) {
  let pdfLib;
  try {
    pdfLib = await import('pdf-lib');
  } catch {
    throw new Error('Internal error: pdf-lib module unavailable');
  }

  await preloadPdfFonts();

  const { PDFDocument } = pdfLib;
  const doc = await PDFDocument.create();
  const fonts = await embedLayoutFonts(doc);

  const margin = 50;
  const bodySize = 11;
  const lineHeight = 14;
  const titleSize = 18;

  let page = doc.addPage();
  let { width, height } = page.getSize();
  let y = height - margin;

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title) {
    page.drawText(title, { x: margin, y, size: titleSize, font: fonts.latin });
    y -= titleSize + 12;
  }

  const body = typeof input.body === 'string' ? input.body : '';
  if (body.length > MAX_PDF_BODY_CHARS) {
    throw new Error(`body exceeds ${MAX_PDF_BODY_CHARS} character limit`);
  }

  const { pages, replaced } = layoutBodyText(body, {
    fonts,
    fontSize: bodySize,
    lineHeight,
    margin,
    pageWidth: width,
    pageHeight: height,
    startY: y,
  });

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (pageIndex > 0) {
      page = doc.addPage();
      ({ width, height } = page.getSize());
    }
    for (const line of pages[pageIndex].lines) {
      drawVisualLine(page, line, { x: margin, y: line.y, size: bodySize });
    }
  }

  return { buffer: Buffer.from(await doc.save()), replaced };
}

/**
 * Excel sheet names cannot contain : \ / ? * [ ].
 * @param {unknown} sheets
 * @returns {Promise<Buffer>}
 */
async function buildSpreadsheetBuffer(sheets) {
  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    throw new Error('Internal error: xlsx module unavailable');
  }

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('sheets must be a non-empty array');
  }

  const book = XLSX.utils.book_new();
  const usedNames = new Set();

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    if (!isObject(sheet)) {
      throw new Error(`sheets[${index}] must be an object`);
    }

    let name =
      typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name.trim() : `Sheet${index + 1}`;
    name = name.replace(/[:\\/?*[\]]/g, '');
    if (!name) name = `Sheet${index + 1}`;
    name = name.slice(0, 31);
    let uniqueName = name;
    let suffix = 2;
    while (usedNames.has(uniqueName)) {
      uniqueName = `${name.slice(0, 28)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(uniqueName);

    const rows = sheet.rows;
    if (!Array.isArray(rows)) {
      throw new Error(`sheets[${index}].rows must be an array of row arrays`);
    }
    if (rows.length > MAX_SHEET_ROWS) {
      throw new Error(`sheets[${index}] exceeds ${MAX_SHEET_ROWS} row limit`);
    }

    const normalizedRows = rows.map((row, rowIndex) => {
      if (!Array.isArray(row)) {
        throw new Error(`sheets[${index}].rows[${rowIndex}] must be an array`);
      }
      return row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') {
          return cell;
        }
        return String(cell);
      });
    });

    const worksheet = XLSX.utils.aoa_to_sheet(normalizedRows);
    XLSX.utils.book_append_sheet(book, worksheet, uniqueName);
  }

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * @param {{ title?: string, sections?: unknown[] }} input
 * @returns {Promise<Buffer>}
 */
async function buildWordBuffer(input) {
  let docx;
  try {
    docx = await import('docx');
  } catch {
    throw new Error('Internal error: docx module unavailable');
  }

  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = docx;
  const children = [];

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title) {
    children.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
      }),
    );
  }

  const sections = Array.isArray(input.sections) ? input.sections : [];
  if (sections.length === 0 && !title) {
    throw new Error('sections must be a non-empty array when title is omitted');
  }
  if (sections.length > MAX_WORD_SECTIONS) {
    throw new Error(`sections exceeds ${MAX_WORD_SECTIONS} item limit`);
  }

  const headingByLevel = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!isObject(section)) {
      throw new Error(`sections[${index}] must be an object`);
    }
    const text = typeof section.text === 'string' ? section.text : '';
    if (!text.trim()) {
      throw new Error(`sections[${index}].text is required`);
    }

    const type = section.type === 'heading' ? 'heading' : 'paragraph';
    if (type === 'heading') {
      const levelRaw = Number(section.level);
      const level = Number.isFinite(levelRaw)
        ? Math.min(6, Math.max(1, Math.trunc(levelRaw)))
        : 1;
      children.push(
        new Paragraph({
          text,
          heading: headingByLevel[level] ?? HeadingLevel.HEADING_1,
        }),
      );
      continue;
    }

    children.push(
      new Paragraph({
        children: [new TextRun(text)],
      }),
    );
  }

  const document = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}

/**
 * @param {string} relativePath
 * @param {string} expectedExt
 */
function assertExtension(relativePath, expectedExt) {
  const ext = extensionOf(relativePath);
  if (ext !== expectedExt) {
    throw new Error(`path must end with .${expectedExt} (got ".${ext || 'none'}")`);
  }
}

/**
 * @param {string} absPath
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function writeBinaryDocument(absPath, buffer) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, buffer);
  return toRelativePath(absPath);
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolCreatePdf(args) {
  const relPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!relPath) return 'Error: path is required';

  try {
    assertExtension(relPath, 'pdf');
    const absPath = resolveSafePath(relPath, { write: true });
    const { buffer, replaced } = await buildPdfBuffer({
      title: typeof args?.title === 'string' ? args.title : undefined,
      body: typeof args?.body === 'string' ? args.body : '',
    });
    const saved = await writeBinaryDocument(absPath, buffer);
    const replacedNote = formatReplacedCharacters(replaced);
    return `Created PDF ${saved} (${buffer.length} bytes)${replacedNote}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) return message;
    return `Error: failed to create PDF: ${message}`;
  }
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolCreateSpreadsheet(args) {
  const relPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!relPath) return 'Error: path is required';

  try {
    assertExtension(relPath, 'xlsx');
    const absPath = resolveSafePath(relPath, { write: true });
    const buffer = await buildSpreadsheetBuffer(args?.sheets);
    const saved = await writeBinaryDocument(absPath, buffer);
    const sheetCount = Array.isArray(args?.sheets) ? args.sheets.length : 0;
    return `Created spreadsheet ${saved} (${buffer.length} bytes, ${sheetCount} sheet(s))`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) return message;
    return `Error: failed to create spreadsheet: ${message}`;
  }
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolCreateWordDocument(args) {
  const relPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!relPath) return 'Error: path is required';

  try {
    assertExtension(relPath, 'docx');
    const absPath = resolveSafePath(relPath, { write: true });
    const buffer = await buildWordBuffer({
      title: typeof args?.title === 'string' ? args.title : undefined,
      sections: args?.sections,
    });
    const saved = await writeBinaryDocument(absPath, buffer);
    const sectionCount = Array.isArray(args?.sections) ? args.sections.length : 0;
    return `Created Word document ${saved} (${buffer.length} bytes, ${sectionCount} section(s))`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Error:')) return message;
    return `Error: failed to create Word document: ${message}`;
  }
}
