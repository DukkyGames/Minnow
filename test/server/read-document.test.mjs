/**
 * read_document server extraction (MIN-32).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractDocumentText,
  isOfficeExtension,
  OFFICE_EXTENSIONS,
  toolReadDocument,
} from '../../server/tools/read-document.js';

/** Build a minimal valid xlsx workbook in memory when xlsx is installed. */
async function buildSampleXlsxBuffer() {
  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    return null;
  }

  const sheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Count'],
    ['Alpha', 1],
    ['Beta', 2],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

describe('read-document extensions', () => {
  it('recognizes common office extensions', () => {
    assert.ok(OFFICE_EXTENSIONS.has('xlsx'));
    assert.ok(isOfficeExtension('budget.xls'));
    assert.ok(isOfficeExtension('notes.docx'));
    assert.equal(isOfficeExtension('photo.png'), false);
  });
});

describe('extractDocumentText spreadsheet', () => {
  it('extracts sheet rows from xlsx when xlsx is installed', async () => {
    const buffer = await buildSampleXlsxBuffer();
    if (!buffer) {
      console.log('skip: xlsx optional dependency not installed');
      return;
    }

    const result = await extractDocumentText(buffer, 'sample.xlsx');
    assert.match(result, /--- sample\.xlsx/);
    assert.match(result, /Sheet: Data/);
    assert.match(result, /Alpha/);
    assert.match(result, /Beta/);
  });
});

describe('toolReadDocument', () => {
  it('rejects unknown extensions', async () => {
    const body = Buffer.from('not office').toString('base64');
    const out = await toolReadDocument({ filename: 'data.bin', content: body });
    assert.match(out, /supports PDF and office/i);
  });

  it('requires base64 content', async () => {
    const out = await toolReadDocument({ filename: 'a.xlsx' });
    assert.match(out, /content .* required/i);
  });
});
