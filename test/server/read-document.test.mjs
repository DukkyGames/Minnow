/**
 * read_document server extraction (MIN-32).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathAccessStore } from '../../server/runtime/path-access.js';
import {
  toolCreatePdf,
  toolCreateSpreadsheet,
  toolCreateWordDocument,
} from '../../server/tools/create-document.js';
import {
  extractDocumentText,
  isOfficeExtension,
  OFFICE_EXTENSIONS,
  toolReadDocument,
} from '../../server/tools/read-document.js';

let tempRoot = '';

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-read-doc-'));
});

after(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function runInWorkspace(fn) {
  return pathAccessStore.run({ workspaceRootOverride: tempRoot }, fn);
}

/** Build an xlsx buffer for extraction tests. */
async function buildSampleXlsxBuffer() {
  const mod = await import('xlsx');
  const XLSX = mod.default ?? mod;

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
  it('extracts sheet rows from xlsx', async () => {
    const buffer = await buildSampleXlsxBuffer();

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

  it('requires path or base64 content', async () => {
    const out = await toolReadDocument({ filename: 'a.xlsx' });
    assert.match(out, /path .* or content .* required/i);
  });

  it('rejects paths outside the workspace', async () => {
    const outside = path.join(os.tmpdir(), `minnow-read-doc-outside-${process.pid}.txt`);
    await fs.writeFile(outside, 'secret', 'utf8');

    const out = await runInWorkspace(() => toolReadDocument({ path: outside }));

    assert.match(out, /outside the workspace/i);
    await fs.rm(outside, { force: true });
  });

  it('reads workspace documents by path', async () => {
    const sheetOut = await runInWorkspace(() =>
      toolCreateSpreadsheet({
        path: 'read-by-path/table.xlsx',
        sheets: [{ name: 'Rows', rows: [['Item', 'Qty'], ['Widget', 3]] }],
      }),
    );

    assert.match(sheetOut, /Created spreadsheet/);

    const out = await runInWorkspace(() => toolReadDocument({ path: 'read-by-path/table.xlsx' }));
    assert.match(out, /Widget/);
    assert.match(out, /Rows/);
  });

  it('round-trips PDF and Word documents created in the workspace', async () => {
    const pdfOut = await runInWorkspace(() =>
      toolCreatePdf({
        path: 'roundtrip/report.pdf',
        title: 'Report',
        body: 'PDF body text',
      }),
    );

    assert.match(pdfOut, /Created PDF/);
    const pdfRead = await runInWorkspace(() => toolReadDocument({ path: 'roundtrip/report.pdf' }));
    assert.match(pdfRead, /PDF body text/);

    const wordOut = await runInWorkspace(() =>
      toolCreateWordDocument({
        path: 'roundtrip/memo.docx',
        sections: [{ type: 'paragraph', text: 'Word paragraph content' }],
      }),
    );

    assert.match(wordOut, /Created Word document/);
    const wordRead = await runInWorkspace(() => toolReadDocument({ path: 'roundtrip/memo.docx' }));
    assert.match(wordRead, /Word paragraph content/);
  });

  it('caps output for very wide spreadsheets', async () => {
    const mod = await import('xlsx');
    const XLSX = mod.default ?? mod;

    const wideRow = Array.from({ length: 800 }, (_, index) => `cell-${index}-data`);
    const sheetOut = await runInWorkspace(() =>
      toolCreateSpreadsheet({
        path: 'wide/wide-sheet.xlsx',
        sheets: [{ name: 'Wide', rows: [wideRow, wideRow, wideRow] }],
      }),
    );
    assert.match(sheetOut, /Created spreadsheet/);

    const out = await runInWorkspace(() => toolReadDocument({ path: 'wide/wide-sheet.xlsx' }));
    assert.match(out, /\[truncated/i);
  });

  it('errors on corrupt xlsx instead of returning garbage text', async () => {
    const corruptPath = 'corrupt/bad.xlsx';
    await runInWorkspace(async () => {
      await fs.mkdir(path.join(tempRoot, 'corrupt'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, corruptPath), 'this is not a zip workbook');
    });

    const out = await runInWorkspace(() => toolReadDocument({ path: corruptPath }));
    assert.match(out, /^Error:/);
    assert.match(out, /ZIP signature|failed to parse/i);
  });
});
