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
import {
  embedLayoutFonts,
  layoutBodyText,
  preloadPdfFonts,
  splitRuns,
} from '../../server/tools/pdf-layout.js';
import { pathAccessStore } from '../../server/runtime/path-access.js';
import { extractDocumentText } from '../../server/tools/read-document.js';

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

async function pdfLibAvailable() {
  try {
    await import('pdf-lib');
    await import('@pdf-lib/fontkit');
    return true;
  } catch {
    return false;
  }
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

  it('round-trips mixed Unicode PDF body text through extractDocumentText', async () => {
    if (!(await pdfLibAvailable())) {
      console.log('skip: pdf-lib or @pdf-lib/fontkit not installed');
      return;
    }

    const sample = 'Café ✅ 日本語 Привет';
    const pdfOut = await runInWorkspace(() =>
      toolCreatePdf({ path: 'unicode/mixed.pdf', body: sample }),
    );
    assert.match(pdfOut, /Created PDF unicode\/mixed\.pdf/);

    const pdfBytes = await fs.readFile(path.join(tempRoot, 'unicode', 'mixed.pdf'));
    const extracted = await extractDocumentText(pdfBytes, 'mixed.pdf');
    for (const part of ['Café', '✅', '日本語', 'Привет']) {
      assert.ok(extracted.includes(part), `expected extracted text to include "${part}"`);
    }
  });

  it('paginates long PDF bodies and keeps line baselines above the margin', async () => {
    if (!(await pdfLibAvailable())) {
      console.log('skip: pdf-lib or @pdf-lib/fontkit not installed');
      return;
    }

    await preloadPdfFonts();
    const pdfLib = await import('pdf-lib');
    const doc = await pdfLib.PDFDocument.create();
    const fonts = await embedLayoutFonts(doc);
    const margin = 50;
    const lineHeight = 14;
    const pageWidth = 612;
    const pageHeight = 792;
    const body = Array.from({ length: 100 }, (_, index) => `Line ${index + 1} with words`).join(
      '\n',
    );

    const { pages } = layoutBodyText(body, {
      fonts,
      fontSize: 11,
      lineHeight,
      margin,
      pageWidth,
      pageHeight,
      startY: pageHeight - margin,
    });

    assert.ok(pages.length > 1, 'expected body to span multiple pages');
    for (const page of pages) {
      for (const line of page.lines) {
        assert.ok(line.y >= margin, `line baseline ${line.y} should stay above margin ${margin}`);
      }
    }

    const pdfOut = await runInWorkspace(() =>
      toolCreatePdf({ path: 'unicode/long.pdf', body }),
    );
    assert.match(pdfOut, /Created PDF unicode\/long\.pdf/);
    const pdfBytes = await fs.readFile(path.join(tempRoot, 'unicode', 'long.pdf'));
    let pdfParse;
    try {
      const mod = await import('pdf-parse');
      pdfParse = mod.default ?? mod;
    } catch {
      console.log('skip: pdf-parse not installed for page count check');
      return;
    }
    const parsed = await pdfParse(pdfBytes);
    assert.ok((parsed?.numpages ?? 0) > 1, 'expected generated PDF to have multiple pages');
  });

  it('wraps a 300-character unbroken token instead of overflowing', async () => {
    if (!(await pdfLibAvailable())) {
      console.log('skip: pdf-lib or @pdf-lib/fontkit not installed');
      return;
    }

    await preloadPdfFonts();
    const pdfLib = await import('pdf-lib');
    const doc = await pdfLib.PDFDocument.create();
    const fonts = await embedLayoutFonts(doc);
    const margin = 50;
    const pageWidth = 612;
    const pageHeight = 792;
    const token = 'x'.repeat(300);

    const { pages } = layoutBodyText(token, {
      fonts,
      fontSize: 11,
      lineHeight: 14,
      margin,
      pageWidth,
      pageHeight,
      startY: pageHeight - margin,
    });

    const lineCount = pages.reduce((count, page) => count + page.lines.length, 0);
    assert.ok(lineCount > 1, 'expected long token to wrap across multiple visual lines');

    const maxWidth = pageWidth - margin * 2;
    for (const page of pages) {
      for (const line of page.lines) {
        let width = 0;
        for (const run of line.runs) {
          width += run.font.widthOfTextAtSize(run.text, 11);
        }
        assert.ok(
          width <= maxWidth + 0.5,
          `visual line width ${width} should not exceed max width ${maxWidth}`,
        );
      }
    }
  });

  it('splits mixed-script lines into latin, emoji, and CJK runs', async () => {
    if (!(await pdfLibAvailable())) {
      console.log('skip: pdf-lib or @pdf-lib/fontkit not installed');
      return;
    }

    await preloadPdfFonts();
    const sample = 'Café✅日本語Привет';
    const { runs } = splitRuns(sample);
    const keys = runs.map((run) => run.fontKey);
    assert.deepEqual(keys, ['latin', 'emoji', 'cjk', 'latin']);
    assert.equal(runs.map((run) => run.text).join(''), sample);
  });
});
