/**
 * create_pdf / create_spreadsheet / create_word_document server tools.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  toolCreatePdf,
  toolCreateSpreadsheet,
  toolCreateWordDocument,
} from '../../server/tools/create-document.js';
import { pathAccessStore } from '../../server/runtime/path-access.js';

let tempRoot = '';

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-create-doc-'));
});

after(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function runInWorkspace(fn) {
  return pathAccessStore.run({ workspaceRootOverride: tempRoot }, fn);
}

describe('create document tools', () => {
  it('rejects paths with wrong extensions', async () => {
    const pdf = await runInWorkspace(() => toolCreatePdf({ path: 'a.txt', body: 'hi' }));
    assert.match(pdf, /must end with \.pdf/i);

    const sheet = await runInWorkspace(() =>
      toolCreateSpreadsheet({ path: 'a.csv', sheets: [{ rows: [['a']] }] }),
    );
    assert.match(sheet, /must end with \.xlsx/i);

    const word = await runInWorkspace(() =>
      toolCreateWordDocument({ path: 'a.txt', sections: [{ text: 'hi' }] }),
    );
    assert.match(word, /must end with \.docx/i);
  });

  it('creates pdf, spreadsheet, and word files when optional deps are installed', async () => {
    const pdfOut = await runInWorkspace(() =>
      toolCreatePdf({
        path: 'reports/summary.pdf',
        title: 'Summary',
        body: 'Hello world',
      }),
    );

    if (/requires the optional "pdf-lib"/i.test(pdfOut)) {
      console.log('skip: pdf-lib optional dependency not installed');
    } else {
      assert.match(pdfOut, /Created PDF reports\/summary\.pdf/);
      const pdfBytes = await fs.readFile(path.join(tempRoot, 'reports', 'summary.pdf'));
      assert.ok(pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-');
    }

    const sheetOut = await runInWorkspace(() =>
      toolCreateSpreadsheet({
        path: 'data/table.xlsx',
        sheets: [{ name: 'Data', rows: [['Name', 'Count'], ['Alpha', 1]] }],
      }),
    );

    if (/requires the optional "xlsx"/i.test(sheetOut)) {
      console.log('skip: xlsx optional dependency not installed');
    } else {
      assert.match(sheetOut, /Created spreadsheet data\/table\.xlsx/);
      const xlsxStat = await fs.stat(path.join(tempRoot, 'data', 'table.xlsx'));
      assert.ok(xlsxStat.size > 0);
    }

    const wordOut = await runInWorkspace(() =>
      toolCreateWordDocument({
        path: 'docs/note.docx',
        title: 'Note',
        sections: [
          { type: 'heading', text: 'Section', level: 2 },
          { type: 'paragraph', text: 'Body text' },
        ],
      }),
    );

    if (/requires the optional "docx"/i.test(wordOut)) {
      console.log('skip: docx optional dependency not installed');
    } else {
      assert.match(wordOut, /Created Word document docs\/note\.docx/);
      const docxStat = await fs.stat(path.join(tempRoot, 'docs', 'note.docx'));
      assert.ok(docxStat.size > 0);
    }
  });
});
